'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  Clock3,
  Copy,
  Gamepad2,
  History,
  LoaderCircle,
  LayoutDashboard,
  ImagePlus,
  FolderOpen,
  Link2,
  Maximize2,
  MessageSquare,
  Monitor,
  Plus,
  RotateCcw,
  Send,
  Smartphone,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import type { GameVersion, Job, Project, ProjectDetail } from '@/shared/types';
import { phaseLabels } from '@/shared/types';
import { AccountMenu, useSession } from './access-gate';
import { DevelopmentProcess, PlanSummary } from './development-process';
import { GameFrame } from './game-frame';
import {
  DesignCanvas,
  type CanvasHandle,
  type CanvasStatus,
} from './design-canvas';

async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    url,
    body === undefined
      ? { cache: 'no-store' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const value = await response.json();
  if (response.status === 401)
    window.dispatchEvent(new Event('opengame-session-expired'));
  if (!response.ok) throw new Error(value.error || '操作未完成，请重试。');
  return value;
}
function date(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
export function Studio({
  projectId,
  initialView = 'home',
  initialWorkspaceView = 'play',
}: {
  projectId?: string;
  initialView?: 'home' | 'library';
  initialWorkspaceView?: 'play' | 'process' | 'design';
}) {
  const router = useRouter();
  const session = useSession();
  const draftKey = `opengame-draft-${session.user ? `${session.user.id}-` : ''}${projectId || 'new'}`;
  const [projects, setProjects] = useState<Project[]>([]);
  const [detail, setDetail] = useState<ProjectDetail>();
  const [previewOrigin, setPreviewOrigin] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [conversationReady, setConversationReady] = useState(false);
  const [runtimeReady, setRuntimeReady] = useState(true);
  const view = initialView;
  const [modal, setModal] = useState<
    'history' | 'publish' | 'memory' | 'standards' | null
  >(null);
  const [memory, setMemory] = useState('');
  const [standards, setStandards] = useState<{
    version: string;
    text: string;
    observations: number;
  }>();
  const [selectedVersion, setSelectedVersion] = useState<string>();
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [reload, setReload] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<
    'play' | 'process' | 'design'
  >(initialWorkspaceView);
  const [canvasStatus, setCanvasStatus] = useState<CanvasStatus>({
    titles: [],
    imageCount: 0,
    dirty: false,
  });
  const canvas = useRef<CanvasHandle>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const request = useRef<{ content: string; key: string } | null>(null);
  const draftRequest = useRef<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const latestJob = detail?.jobs[0];
  const running =
    latestJob?.status === 'queued' || latestJob?.status === 'running';
  const currentVersion = detail?.versions.find(
    (v) => v.id === (selectedVersion || detail.project.latest_version_id),
  );

  const refresh = useCallback(async () => {
    const [list, status] = await Promise.all([
      api<{ projects: Project[]; previewOrigin: string }>('/api/projects'),
      api<{ workerReady: boolean; runtimeReady: boolean }>('/api/status'),
    ]);
    setProjects(list.projects);
    setPreviewOrigin(list.previewOrigin);
    setReady(status.workerReady && status.runtimeReady);
    setConversationReady(status.workerReady);
    setRuntimeReady(status.runtimeReady);
    if (projectId)
      setDetail(await api<ProjectDetail>(`/api/projects/${projectId}`));
  }, [projectId]);
  useEffect(() => {
    let live = true;
    const poll = () => {
      if (live)
        void refresh().catch((e) => {
          if (live) setError(e.message);
        });
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    setSelectedVersion(undefined);
    setDetail(undefined);
    setPrompt(localStorage.getItem(draftKey) || '');
  }, [projectId, draftKey]);
  useEffect(() => {
    if (modal) dialog.current?.showModal();
    else dialog.current?.close();
  }, [modal]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    scroll.current?.scrollTo({
      top: scroll.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [detail?.messages.length, detail?.events.length]);
  function draft(value: string) {
    setPrompt(value);
    localStorage.setItem(draftKey, value);
  }
  async function submit() {
    if (!prompt.trim() || busy || running) return;
    setBusy(true);
    setError('');
    try {
      const selection = projectId
        ? await canvas.current?.prepareSubmission()
        : undefined;
      if (projectId && !selection)
        throw new Error('设计画布尚未加载，请稍后再试。');
      const content = JSON.stringify([
        projectId,
        detail?.project.latest_version_id,
        prompt.trim(),
        selection,
      ]);
      if (request.current?.content !== content)
        request.current = { content, key: crypto.randomUUID() };
      const result = await api<{ projectId: string }>(
        projectId ? `/api/projects/${projectId}/jobs` : '/api/projects',
        {
          prompt: prompt.trim(),
          kind: 'chat',
          requestKey: request.current.key,
          ...(selection ? { canvas: selection } : {}),
          ...(projectId
            ? { baseVersionId: detail?.project.latest_version_id || null }
            : {}),
        },
      );
      draft('');
      request.current = null;
      setSelectedVersion(undefined);
      if (projectId) await refresh();
      else router.push(`/projects/${result.projectId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function startWithDesign() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      draftRequest.current ||= crypto.randomUUID();
      const created = await api<{ projectId: string }>('/api/projects/drafts', {
        requestKey: draftRequest.current,
      });
      if (prompt.trim())
        localStorage.setItem(
          `opengame-draft-${session.user ? `${session.user.id}-` : ''}${created.projectId}`,
          prompt,
        );
      router.push(`/projects/${created.projectId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function startPlan(job: Job) {
    if (busy || running || !projectId) return;
    await action(async () => {
      const content = `start-plan:${job.id}`;
      if (request.current?.content !== content)
        request.current = { content, key: crypto.randomUUID() };
      await api(`/api/projects/${projectId}/jobs`, {
        prompt: '按这份方案开始制作。',
        kind: 'build',
        sourcePlanId: job.id,
        baseVersionId: detail?.project.latest_version_id || null,
        requestKey: request.current.key,
      });
      request.current = null;
      setSelectedVersion(undefined);
      setWorkspaceView('process');
    });
  }
  async function attachReference(file?: File) {
    if (!file) return;
    setError('');
    try {
      if (!canvas.current) throw new Error('项目资料还在加载，请稍后再试。');
      const upload = canvas.current.attachImage(file);
      setBusy(true);
      await upload;
      setToast('参考图已加入本轮对话，发送时会一起保存。');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (attachmentInput.current) attachmentInput.current.value = '';
    }
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function restore(version: GameVersion) {
    if (
      canvas.current?.hasChanges() &&
      !window.confirm(
        '恢复版本会替换当前未保存的设计草稿。确定恢复这个游戏及其当时的画布吗？',
      )
    )
      return;
    await action(async () => {
      if (!canvas.current) throw new Error('画布尚未加载，请稍后重试。');
      await api(`/api/projects/${projectId}/restore`, {
        versionId: version.id,
        expectedVersionId: detail?.project.latest_version_id,
        expectedCanvasRevision: canvas.current.revision(),
      });
      await canvas.current.reload();
      setSelectedVersion(undefined);
      setModal(null);
      setToast('已恢复为新版本，原有历史完整保留。');
    });
  }
  async function publish() {
    if (!currentVersion) return;
    await action(async () => {
      const result = await api<{ url: string }>(
        `/api/projects/${projectId}/publish`,
        {
          versionId: currentVersion.id,
          expectedVersionId: detail?.project.released_version_id,
        },
      );
      setShareUrl(result.url);
      setToast(
        session.mode === 'local'
          ? '版本已发布到本机试玩页。'
          : '版本已发布，受邀成员可以通过分享链接试玩。',
      );
    });
  }
  async function showMemory() {
    setMemory('正在读取项目记忆…');
    setModal('memory');
    try {
      setMemory(
        (await api<{ memory: string }>(`/api/projects/${projectId}/memory`))
          .memory,
      );
    } catch (e) {
      setMemory((e as Error).message);
    }
  }
  async function showStandards() {
    setModal('standards');
    try {
      setStandards(await api('/api/standards'));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const composer = (
    <div className="composer">
      {projectId && (
        <div className="composer-references">
          <button
            disabled={busy || !!selectedVersion}
            onClick={() => attachmentInput.current?.click()}
          >
            <ImagePlus size={14} /> 添加参考图
          </button>
          <input
            ref={attachmentInput}
            type="file"
            accept="image/png,image/jpeg"
            hidden
            onChange={(e) => void attachReference(e.target.files?.[0])}
          />
          {!!canvasStatus.titles.length && (
            <button onClick={() => setWorkspaceView('design')}>
              <Link2 size={12} />
              {canvasStatus.titles.length
                ? `已引用 ${canvasStatus.titles.length} 项设计${canvasStatus.imageCount ? ` · 含 ${canvasStatus.imageCount} 张图` : ''}`
                : '项目资料'}
            </button>
          )}
          {!!canvasStatus.titles.length && (
            <>
              <span title={canvasStatus.titles.join('、')}>
                {canvasStatus.titles.join('、')}
              </span>
              <button
                className="icon-button"
                aria-label="清空本次引用"
                disabled={busy}
                onClick={() => canvas.current?.clearSelection()}
              >
                <X size={12} />
              </button>
            </>
          )}
        </div>
      )}
      {!!canvasStatus.images?.length && (
        <div className="composer-images">
          {canvasStatus.images.map((image, i) => (
            <img
              key={`${image.id}-${i}`}
              alt={image.title}
              title={image.title}
              src={`/api/projects/${projectId}/canvas/assets/${image.id}`}
            />
          ))}
        </div>
      )}
      <label className="sr-only" htmlFor="prompt">
        {projectId ? '聊想法或描述想修改的地方' : '描述你想制作的游戏'}
      </label>
      <textarea
        id="prompt"
        value={prompt}
        maxLength={8000}
        onChange={(e) => draft(e.target.value)}
        placeholder={
          projectId
            ? '聊聊玩法，或直接告诉我这次要改什么…'
            : '描述一个你想玩的游戏，玩法可以天马行空…'
        }
        onKeyDown={(e) => {
          if (
            (e.metaKey || e.ctrlKey) &&
            e.key === 'Enter' &&
            !e.nativeEvent.isComposing
          ) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div className="composer-footer">
        <span>
          {running
            ? '处理中，可以先记下下一个想法'
            : projectId
              ? '聊想法；明确要求制作时开始实施'
              : '从一句话开始 · ⌘ / Ctrl + Enter'}
        </span>
        <button
          className="send-button"
          aria-label="发送消息"
          disabled={busy || running || !prompt.trim() || !conversationReady}
          onClick={() => void submit()}
        >
          {busy ? (
            <LoaderCircle size={18} className="spin" />
          ) : (
            <ArrowUp size={19} />
          )}
        </button>
      </div>
    </div>
  );

  return (
    <div className="studio-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brandmark">
            <Gamepad2 size={21} />
          </span>
          OpenGame
        </Link>
        <nav className="topnav" aria-label="主导航">
          <Link
            className={!projectId && view === 'home' ? 'active' : ''}
            href="/"
          >
            创作
          </Link>
          <Link
            className={!projectId && view === 'library' ? 'active' : ''}
            href="/library"
          >
            我的作品
          </Link>
<Link href="/marketplace">作品广场</Link>
          <button onClick={() => void showStandards()}>制作规范</button>
          <Link href="/knowledge">知识库</Link>
        </nav>
        <AccountMenu />
      </header>
      {error && (
        <div className="error-box global-error" role="alert">
          <span>{error}</span>
          <button aria-label="关闭提示" onClick={() => setError('')}>
            <X size={17} />
          </button>
        </div>
      )}
      {!ready && (
        <div className="service-note">
          <Clock3 size={14} />
          {runtimeReady
            ? '创作服务正在连接，已保存的游戏仍可查看。'
            : session.mode === 'local'
              ? '项目独立环境尚未就绪，请启动本机 Docker 并准备运行环境。已保存的游戏仍可试玩。'
              : '创作环境暂未就绪，请稍后重试。已保存的游戏仍可试玩。'}
          <button
            onClick={() => void refresh().catch((e) => setError(e.message))}
          >
            重新检查
          </button>
        </div>
      )}
      {!projectId ? (
        <main className="home">
          <div className="home-heading">
            <span className="eyebrow">
              <Sparkles size={15} />
              每一个想法，都值得被玩到
            </span>
            <h1>
              {view === 'library' ? (
                '你的游戏，都在这里。'
              ) : (
                <>
                  把脑海里的玩法，
                  <br className="mobile-break" />
                  变成能玩的游戏。
                </>
              )}
            </h1>
            <p>
              {view === 'library'
                ? '继续一个故事，或者开始一次全新的冒险。'
                : '告诉我你的想法，一起制作、试玩，再把它变得更好。'}
            </p>
          </div>
          {view === 'home' && (
            <div className="home-compose">
              {composer}
              <div className="suggestions">
                {[
                  '用抽卡控制飞船躲避陨石',
                  '一家会发生奇遇的猫咪咖啡馆',
                  '把音乐节奏变成迷宫机关',
                ].map((idea) => (
                  <button key={idea} onClick={() => draft(idea)}>
                    <Plus size={13} />
                    {idea}
                  </button>
                ))}
              </div>
              <button
                className="start-with-design"
                disabled={busy}
                onClick={() => void startWithDesign()}
              >
                <ImagePlus size={14} /> 打开创作空间，添加参考图{' '}
                <ArrowUpRight size={13} />
              </button>
            </div>
          )}
          <section className="projects-section">
            <div className="section-heading">
              <h2>{view === 'library' ? '我的作品' : '最近的创作'}</h2>
              <span>{projects.length} 个项目</span>
            </div>
            {projects.length ? (
              <div className="project-grid">
                {projects.map((project) => (
                  <Link
                    className="project-card"
                    key={project.id}
                    href={`/projects/${project.id}`}
                  >
                    <div className="project-cover">
                      {project.latest_version_id && previewOrigin ? (
                        <img
                          alt={`${project.title} 游戏画面`}
                          src={project.previewUrl}
                        />
                      ) : (
                        <div className="cover-empty">
                          <Gamepad2 size={35} />
                          <span>想法正在成形</span>
                        </div>
                      )}
                      <span className="project-tag">
                        {project.source === 'sample'
                          ? '参考作品'
                          : project.released_version_id
                            ? '已发布'
                            : '私有作品'}
                      </span>
                    </div>
                    <div className="project-info">
                      <h3>{project.title}</h3>
                      <p>{project.description}</p>
                      <div>
                        <span>{date(project.updated_at)}</span>
                        <ArrowUpRight size={16} />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="empty-library">
                <Gamepad2 size={34} />
                <h3>第一款游戏，从你的想法开始</h3>
                <p>创建后，游戏版本和项目记忆都会保存在这里。</p>
              </div>
            )}
          </section>
          <p className="home-footnote">
            <span className="status-dot" />
            {ready
              ? '创作与独立检查环境已就绪'
              : runtimeReady
                ? '等待创作服务'
                : '等待项目独立环境'}
            <span>每个项目独立保存 · 原创玩法，自由组合</span>
          </p>
        </main>
      ) : (
        <main className={`workbench ${expanded ? 'expanded' : ''}`}>
          <div className="project-heading">
            <div className="project-name">
              <Link href="/" className="icon-button" aria-label="返回作品">
                <ChevronLeft size={18} />
              </Link>
              <div>
                <h1>{detail?.project.title || '正在打开项目…'}</h1>
                <p>
                  {detail?.project.source === 'sample'
                    ? '参考作品 · 可以试玩，也可以继续修改'
                    : currentVersion
                      ? `已保存 ${date(currentVersion.created_at)}`
                      : '你的需求与制作过程会自动保存'}
                </p>
              </div>
            </div>
            <div className="heading-actions">
              <button
                className="button"
                disabled={!detail?.versions.length}
                onClick={() => setModal('history')}
              >
                <History size={15} />
                <span>版本记录</span>
              </button>
              <button
                className="button primary"
                disabled={!currentVersion}
                onClick={() => {
                  setShareUrl(
                    detail?.project.released_version_id
                      ? `${location.origin}/play/${projectId}`
                      : '',
                  );
                  setModal('publish');
                }}
              >
                <Send size={14} />
                发布与分享
              </button>
            </div>
          </div>
          <div className="workspace">
            <section className="preview-area">
              <div className="preview-toolbar">
                <div
                  className="workspace-tabs"
                  role="tablist"
                  aria-label="项目视图"
                >
                  <button
                    id="play-tab"
                    role="tab"
                    aria-selected={workspaceView === 'play'}
                    aria-controls="play-panel"
                    onClick={() => setWorkspaceView('play')}
                  >
                    <Gamepad2 size={15} /> 在线试玩
                  </button>
                  <button
                    id="process-tab"
                    role="tab"
                    aria-selected={workspaceView === 'process'}
                    aria-controls="process-panel"
                    onClick={() => setWorkspaceView('process')}
                  >
                    <LayoutDashboard size={15} /> 制作过程
                  </button>
                </div>
                <span className="preview-label workspace-version">
                  {currentVersion && (
                    <button onClick={() => setModal('history')}>
                      版本 {currentVersion.number}
                      <ChevronDown size={13} />
                    </button>
                  )}
                </span>
                <div className="preview-controls">
                  <button
                    className="icon-button"
                    aria-label="项目资料"
                    title="项目资料"
                    aria-pressed={workspaceView === 'design'}
                    onClick={() =>
                      setWorkspaceView(
                        workspaceView === 'design' ? 'play' : 'design',
                      )
                    }
                  >
                    <FolderOpen size={16} />
                  </button>
                  <div
                    className="device-toggle"
                    hidden={workspaceView !== 'play'}
                  >
                    <button
                      aria-label="桌面预览"
                      aria-pressed={device === 'desktop'}
                      onClick={() => setDevice('desktop')}
                    >
                      <Monitor size={15} />
                    </button>
                    <button
                      aria-label="窄屏预览"
                      aria-pressed={device === 'mobile'}
                      onClick={() => setDevice('mobile')}
                    >
                      <Smartphone size={15} />
                    </button>
                  </div>
                  <button
                    className="icon-button"
                    hidden={workspaceView !== 'play'}
                    aria-label="重新载入游戏"
                    disabled={!currentVersion}
                    onClick={() => setReload(reload + 1)}
                  >
                    <RotateCcw size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={expanded ? '显示对话' : '放大试玩'}
                    onClick={() => setExpanded(!expanded)}
                  >
                    <Maximize2 size={16} />
                  </button>
                </div>
              </div>
              <div
                id="play-panel"
                role="tabpanel"
                aria-labelledby="play-tab"
                hidden={workspaceView !== 'play'}
                className={`game-stage ${device === 'mobile' ? 'narrow' : ''}`}
              >
                {currentVersion?.previewUrl ? (
                  <GameFrame
                    key={`${currentVersion.id}-${reload}`}
                    title="游戏试玩"
                    gameTitle={detail?.project.title}
                    src={currentVersion.previewUrl}
                    onRetry={() => setReload((value) => value + 1)}
                  />
                ) : (
                  <div className="preview-empty">
                    <div className="empty-orbit">
                      <Gamepad2 size={32} />
                    </div>
                    <h2>
                      {running && latestJob.kind !== 'chat'
                        ? '你的世界，正在成形'
                        : '在这里，试玩你的想法'}
                    </h2>
                    <p>
                      {running && latestJob.kind !== 'chat'
                        ? '制作完成并检查通过后，游戏会出现在这里。'
                        : '先在右侧聊聊玩法，想法明确后再开始制作。'}
                    </p>
                    {running && (
                      <span className="stage-status">
                        <LoaderCircle className="spin" size={15} />
                        {phaseLabels[latestJob.phase]}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div
                id="process-panel"
                className="process-panel"
                role="tabpanel"
                aria-labelledby="process-tab"
                hidden={workspaceView !== 'process'}
              >
                <DevelopmentProcess
                  detail={detail}
                  busy={busy}
                  ready={ready}
                  onStart={(job) => void startPlan(job)}
                  onPlay={(id) => {
                    setSelectedVersion(
                      id === detail?.project.latest_version_id ? undefined : id,
                    );
                    setWorkspaceView('play');
                  }}
                />
              </div>
              <div
                id="design-panel"
                className="canvas-panel"
                role="region"
                aria-label="项目资料"
                hidden={workspaceView !== 'design'}
              >
                <DesignCanvas
                  key={projectId}
                  ref={canvas}
                  projectId={projectId}
                  memberId={session.user?.id}
                  locked={busy}
                  onStatus={setCanvasStatus}
                  historicalVersion={
                    selectedVersion && currentVersion
                      ? { id: currentVersion.id, number: currentVersion.number }
                      : undefined
                  }
                />
              </div>
              <div className="preview-footer" hidden={workspaceView !== 'play'}>
                <span>
                  {currentVersion ? (
                    <>
                      <Check size={13} />
                      {currentVersion.validation.environment?.kind === 'docker'
                        ? '已在独立容器中通过启动与重开检查'
                        : '已通过启动与重开检查'}
                    </>
                  ) : (
                    <>
                      <Clock3 size={13} />
                      等待第一个可玩版本
                    </>
                  )}
                </span>
                <span>
                  {device === 'mobile'
                    ? '窄屏预览不代表已适配触屏'
                    : '点击游戏区域开始操作'}
                </span>
              </div>
              {selectedVersion && (
                <div className="version-note">
                  正在查看已保存版本及其设计快照。
                  <button onClick={() => setSelectedVersion(undefined)}>
                    回到当前工作区
                  </button>
                </div>
              )}
            </section>
            <aside className="chat-panel">
              <div className="chat-header">
                <MessageSquare size={15} />
                <strong>一起制作</strong>
                <button
                  className="icon-button"
                  aria-label="查看项目记忆"
                  onClick={() => void showMemory()}
                >
                  <BookOpen size={15} />
                </button>
              </div>
              <div className="messages" ref={scroll}>
                {detail?.messages.map((message) => {
                  const job = detail.jobs.find((j) => j.id === message.job_id);
                  const planMessage =
                    message.role === 'assistant' &&
                    job?.plan &&
                    message.content === job.planning_reply;
                  return (
                    <div key={message.id} className={`message ${message.role}`}>
                      <div className="message-label">
                        {message.role === 'user' ? (
                          '你'
                        ) : (
                          <>
                            <Sparkles size={13} />
                            OpenGame
                          </>
                        )}
                      </div>
                      <p>{message.content}</p>
                      {planMessage && (
                        <PlanSummary
                          plan={job.plan!}
                          onView={() => setWorkspaceView('process')}
                          disabled={busy || running || !ready}
                          onStart={
                            job.id === latestJob?.id &&
                            job.kind === 'chat' &&
                            job.status === 'succeeded' &&
                            job.base_version_id ===
                              detail.project.latest_version_id
                              ? () => void startPlan(job)
                              : undefined
                          }
                        />
                      )}
                    </div>
                  );
                })}
                {!detail?.messages.length && (
                  <div className="assistant-intro">
                    <Sparkles size={22} />
                    <p>
                      这款游戏有自己的记忆。告诉我想保留什么、改变什么，我们从这里继续。
                    </p>
                  </div>
                )}
                {running && (
                  <div className="job-progress" role="status">
                    <strong>
                      <LoaderCircle className="spin" size={14} />
                      {latestJob.cancel_requested
                        ? '正在停止'
                        : phaseLabels[latestJob.phase]}
                    </strong>
                    <p>{detail?.events.at(-1)?.message}</p>
                    <button
                      disabled={latestJob.cancel_requested || busy}
                      onClick={() =>
                        void action(async () => {
                          await api(`/api/jobs/${latestJob.id}/cancel`, {});
                        })
                      }
                    >
                      <Square size={11} />
                      停止本轮
                    </button>
                  </div>
                )}
                {latestJob?.status === 'failed' && (
                  <div className="job-failure">
                    <strong>
                      {latestJob.kind === 'chat'
                        ? '这次对话没有完成'
                        : '这次制作没有完成'}
                    </strong>
                    <p>{latestJob.error}</p>
                    <button onClick={() => draft(latestJob.prompt)}>
                      再次尝试
                    </button>
                  </div>
                )}
                {latestJob?.status === 'cancelled' && (
                  <div className="job-neutral">
                    本轮已停止，已保存的版本保持不变。
                  </div>
                )}
              </div>
              <div className="chat-compose">
                {composer}
                <span className="chat-note">
                  <BookOpen size={11} />
                  项目记忆与版本一起保存
                </span>
              </div>
            </aside>
          </div>
        </main>
      )}
      <dialog
        ref={dialog}
        onCancel={() => setModal(null)}
        onClick={(e) => {
          if (e.target === dialog.current) setModal(null);
        }}
      >
        <div className="dialog-heading">
          <h2>
            {modal === 'history'
              ? '每一步，都能回头'
              : modal === 'publish'
                ? '分享你的游戏'
                : modal === 'memory'
                  ? '这个项目的记忆'
                  : '共同的制作规范'}
          </h2>
          <button
            className="icon-button"
            aria-label="关闭窗口"
            onClick={() => setModal(null)}
          >
            <X size={18} />
          </button>
        </div>
        {modal === 'history' && (
          <>
            <p className="dialog-description">
              查看之前的游戏及设计画布。恢复会把当时的游戏和画布保存成新版本；没有画布的早期版本会恢复为空画布。全部历史与已发布版本保留。
            </p>
            <div className="version-list">
              {detail?.versions.map((version) => (
                <div className="version-row" key={version.id}>
                  <button
                    onClick={() => {
                      setSelectedVersion(version.id);
                      setModal(null);
                    }}
                  >
                    <strong>
                      版本 {version.number}
                      {version.id === detail.project.latest_version_id && (
                        <span className="small-badge">当前</span>
                      )}
                      {version.id === detail.project.released_version_id && (
                        <span className="small-badge">已发布</span>
                      )}
                    </strong>
                    <small>{date(version.created_at)}</small>
                    <p>{version.summary}</p>
                  </button>
                  <button
                    className="button"
                    disabled={
                      busy ||
                      running ||
                      version.id === detail.project.latest_version_id
                    }
                    onClick={() => void restore(version)}
                  >
                    恢复
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        {modal === 'publish' && (
          <>
            <p className="dialog-description">
              发布版本 {currentVersion?.number}
              。后续修改会先保存在工作台，不影响已经发布的游戏。
            </p>
            <div className="publish-destination">
              <span className="destination-icon">
                <Gamepad2 size={23} />
              </span>
              <div>
                <strong>
                  自有平台 ·{' '}
                  {session.mode === 'local' ? '本机试玩' : '内测试玩'}
                </strong>
                <p>
                  {session.mode === 'local'
                    ? '当前地址仅在这台电脑上可用。公网分享将在部署后开放。'
                    : '分享给受邀成员试玩。对方需先用自己的访问码登录。'}
                </p>
              </div>
              <Check size={18} />
            </div>
            {shareUrl && (
              <div className="share-field">
                <label htmlFor="share-url">试玩地址</label>
                <div>
                  <input
                    id="share-url"
                    value={shareUrl}
                    readOnly
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    className="icon-button"
                    aria-label="复制地址"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(shareUrl)
                        .then(() => setToast('地址已复制'))
                        .catch(() => setToast('请选中地址手动复制'))
                    }
                  >
                    <Copy size={16} />
                  </button>
                </div>
                <a href={shareUrl} target="_blank" rel="noreferrer">
                  打开试玩页 <ArrowUpRight size={13} />
                </a>
              </div>
            )}
            <div className="dialog-actions">
              <button className="button" onClick={() => setModal(null)}>
                稍后再说
              </button>
              <button
                className="button primary"
                disabled={busy || !currentVersion}
                onClick={() => void publish()}
              >
                {busy ? '正在发布…' : '发布这个版本'}
              </button>
            </div>
          </>
        )}
        {modal === 'memory' && <pre className="text-document">{memory}</pre>}
        {modal === 'standards' && (
          <>
            {standards ? (
              <>
                <p className="dialog-description">
                  基础规范 v{standards.version} · 已记录{' '}
                  {standards.observations} 次任务经验
                </p>
                <pre className="text-document">{standards.text}</pre>
                <p className="dialog-description">
                  知识库会按需求提供已有经验，并收录新项目的经验。公共规范仍按版本维护。
                </p>
                <Link href="/knowledge">查看游戏知识库 →</Link>
              </>
            ) : (
              <p>正在读取…</p>
            )}
          </>
        )}
      </dialog>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
