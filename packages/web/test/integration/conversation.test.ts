import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { databaseUrl } from '../../src/server/config';
import { pool, migrate } from '../../src/server/db';
import { createInvitation } from '../../src/server/access';
import {
  submitJob,
  claimJob,
  finishPlanning,
  getProject,
  cancelJob,
  failJob,
  finishVersion,
  restoreVersion,
} from '../../src/server/store';
import { saveCanvas } from '../../src/server/canvas';
import type { DevelopmentPlan } from '../../src/shared/development';
import type { Job, PreparedVersion } from '../../src/shared/types';

let admin: pg.Client;
const name = `opengame_conversation_${process.pid}`;
before(async () => {
  const original = databaseUrl();
  admin = new pg.Client({ connectionString: original });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(original);
  url.pathname = `/${name}`;
  process.env.OPENGAME_DATABASE_URL = url.toString();
  await migrate();
});
after(async () => {
  await pool().end();
  await admin.query(`DROP DATABASE ${name}`);
  await admin.end();
});
const plan: DevelopmentPlan = {
  goal: '给机器人增加连击奖励',
  decisions: ['保留原移动方式'],
  tasks: [
    { title: '连击计分', detail: '连续收集星星提高奖励，重新开始清零。' },
  ],
  checks: ['收集后分数变化，重开回到零分'],
};
async function chat(prompt = '先讨论连击奖励，暂不修改') {
  const p = await submitJob({ prompt, kind: 'chat', requestKey: randomUUID() });
  return { ...p, job: (await claimJob())! };
}
function result(): PreparedVersion {
  const id = randomUUID();
  return {
    id,
    artifactKey: id,
    artifactHash: 'a'.repeat(64),
    commitSha: 'b'.repeat(40),
    summary: '连击已加入，可试玩。',
    standardsVersion: '0.1.0',
    validation: {
      build: true,
      browser: true,
      start: true,
      restart: true,
      errors: [],
      checkedAt: new Date().toISOString(),
    },
  };
}

test('discussion finishes without changing game versions, experiences, or release pointers', async () => {
  const { projectId, job } = await chat();
  assert.equal(job.phase, 'planning');
  await finishPlanning(job, {
    action: 'discuss',
    reply: '可以先聊连击规则。',
    plan: null,
  });
  const detail = await getProject(projectId);
  assert.equal(detail.versions.length, 0);
  assert.equal(detail.project.latest_version_id, null);
  assert.equal(detail.project.released_version_id, null);
  assert.equal(detail.jobs[0].kind, 'chat');
  assert.equal(detail.jobs[0].status, 'succeeded');
  assert.equal(detail.messages.at(-1)?.content, '可以先聊连击规则。');
  assert.equal(detail.messages.at(-1)?.job_id, job.id);
  assert.equal(
    (
      await pool().query(
        'SELECT * FROM studio_experiences WHERE project_id=$1',
        [projectId],
      )
    ).rowCount,
    0,
  );
});

test('implementation freezes its plan before generation and saves it with the result; restored versions preserve the plan', async () => {
  const { projectId, job } = await chat('请直接增加连击奖励');
  const build = await finishPlanning(job, {
    action: 'implement',
    reply: '我会增加连击计分，并保留移动。',
    plan,
  });
  assert.equal(build.kind, 'build');
  assert.equal(build.status, 'running');
  assert.deepEqual(build.plan, plan);
  assert.equal((await getProject(projectId)).versions.length, 0);
  const version = result();
  await finishVersion(build, version);
  let detail = await getProject(projectId);
  assert.deepEqual(detail.versions[0].development_plan, plan);
  assert.equal(detail.jobs[0].result_version_id, version.id);
  await submitJob({
    projectId,
    baseVersionId: version.id,
    prompt: '第二轮修改',
    requestKey: randomUUID(),
  });
  const next = result();
  await finishVersion((await claimJob())!, next);
  const restored = await restoreVersion(projectId, version.id, next.id);
  detail = await getProject(projectId);
  assert.deepEqual(
    detail.versions.find((v) => v.id === restored)?.development_plan,
    plan,
  );
});

test('starting a proposal is idempotent and uses its frozen reference snapshot', async () => {
  const { projectId, job } = await chat();
  await finishPlanning(job, {
    action: 'propose',
    reply: '建议这样实现。',
    plan,
  });
  await saveCanvas(projectId, undefined, {
    revision: 0,
    document: { version: 1, nodes: [], layout: {} },
  });
  const input = {
    projectId,
    sourcePlanId: job.id,
    prompt: '开始制作',
    requestKey: randomUUID(),
  };
  const first = await submitJob(input);
  assert.deepEqual(await submitJob(input), first);
  const build = (await claimJob())!;
  assert.deepEqual(build.plan, plan);
  assert.equal(build.canvas_snapshot, null);
  await failJob(build, 'Fixture finished');
});

test('new discussion invalidates an older proposal, including when the game version has not changed', async () => {
  const { projectId, job } = await chat();
  await finishPlanning(job, { action: 'propose', reply: '可以这样做。', plan });
  await submitJob({
    projectId,
    kind: 'chat',
    prompt: '先别做了',
    requestKey: randomUUID(),
  });
  await finishPlanning((await claimJob())!, {
    action: 'discuss',
    reply: '好的，先讨论。',
    plan: null,
  });
  await assert.rejects(
    submitJob({
      projectId,
      sourcePlanId: job.id,
      prompt: '开始制作',
      requestKey: randomUUID(),
    }),
    /方案已有/,
  );
  assert.equal((await getProject(projectId)).versions.length, 0);
});

test('cancelled conversations and stale leases cannot start implementation or publish a reply', async () => {
  const { projectId, job } = await chat();
  const proposal = { action: 'implement' as const, reply: '开始实现', plan };
  await assert.rejects(
    finishPlanning({ ...job, lease_token: randomUUID() }, proposal),
    /执行权/,
  );
  await cancelJob(job.id);
  await assert.rejects(finishPlanning(job, proposal), /已停止/);
  await failJob(job, '已停止', true);
  const detail = await getProject(projectId);
  assert.equal(detail.jobs[0].kind, 'chat');
  assert.equal(detail.jobs[0].status, 'cancelled');
  assert.equal(detail.messages.length, 1);
  assert.equal(detail.versions.length, 0);
});

test('another member cannot consume a private proposal or bypass project scoping', async () => {
  const a = await createInvitation('Conversation A');
  const b = await createInvitation('Conversation B');
  const first = await submitJob({
    prompt: '讨论方案',
    kind: 'chat',
    requestKey: randomUUID(),
    ownerId: a.id,
  });
  const job = (await claimJob())!;
  await finishPlanning(job, { action: 'propose', reply: '方案已整理。', plan });
  await assert.rejects(
    submitJob({
      projectId: first.projectId,
      ownerId: b.id,
      sourcePlanId: job.id,
      prompt: '开始制作',
      requestKey: randomUUID(),
    }),
    /找不到/,
  );
  const own = await submitJob({
    prompt: '我自己的项目',
    kind: 'chat',
    requestKey: randomUUID(),
    ownerId: b.id,
  });
  await finishPlanning((await claimJob())!, {
    action: 'discuss',
    reply: '聊聊想法。',
    plan: null,
  });
  await assert.rejects(
    submitJob({
      projectId: own.projectId,
      ownerId: b.id,
      sourcePlanId: job.id,
      prompt: '开始制作',
      requestKey: randomUUID(),
    }),
    /方案已有/,
  );
});

test('discussion has its own bounded quota and cannot bypass a full implementation quota', async () => {
  const owner = await createInvitation('Conversation quota');
  await pool().query(
    'UPDATE studio_users SET daily_job_limit=1,total_job_limit=10 WHERE id=$1',
    [owner.id],
  );
  const project = await submitJob({
    ownerId: owner.id,
    prompt: '第一版游戏',
    requestKey: randomUUID(),
  });
  const version = result();
  await finishVersion((await claimJob())!, version);
  const input = {
    ownerId: owner.id,
    projectId: project.projectId,
    baseVersionId: version.id,
    kind: 'chat' as const,
    prompt: '讨论新的修改',
  };
  await submitJob({ ...input, requestKey: randomUUID() });
  await finishPlanning((await claimJob())!, {
    action: 'discuss',
    reply: '可以继续讨论，不会消耗制作次数。',
    plan: null,
  });
  await submitJob({
    ...input,
    prompt: '现在开始修改',
    requestKey: randomUUID(),
  });
  const waiting = await finishPlanning((await claimJob())!, {
    action: 'implement',
    reply: '开始实施',
    plan,
  });
  assert.equal(waiting.kind, 'chat');
  assert.equal(waiting.status, 'succeeded');
  assert.match(waiting.planning_reply!, /暂未开始实施/);
  assert.deepEqual(waiting.plan, plan);
  await assert.rejects(
    submitJob({
      ...input,
      kind: 'build',
      sourcePlanId: waiting.id,
      requestKey: randomUUID(),
    }),
    /制作次数上限/,
  );
  for (let i = 0; i < 3; i++) {
    await submitJob({ ...input, requestKey: randomUUID() });
    await finishPlanning((await claimJob())!, {
      action: 'discuss',
      reply: '继续讨论。',
      plan: null,
    });
  }
  await assert.rejects(
    submitJob({ ...input, requestKey: randomUUID() }),
    /对话次数上限/,
  );
  assert.equal(
    (await getProject(project.projectId, owner.id)).versions.length,
    1,
  );
});
