import React, {
  createContext,
  forwardRef,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export const SHARED_EMBEDDED_WEBVIEW_PARTITION = 'persist:data-factory';

export type EmbeddedWebviewElement = HTMLElement & {
  getURL?: () => string;
  loadURL?: (url: string) => Promise<void>;
  reload?: () => void;
  executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>;
  getZoomFactor?: () => number;
  setZoomFactor?: (factor: number) => void;
};

export type EmbeddedWebviewFailure = {
  errorCode: number;
  errorDescription: string;
  validatedURL: string;
  isMainFrame: boolean;
};

type EmbeddedWebviewFailureEvent = Event & Partial<EmbeddedWebviewFailure>;

type SharedEmbeddedWebviewProps = {
  src: string;
  className?: string;
  style?: React.CSSProperties;
  allowPopups?: boolean;
  active?: boolean;
  surfacePriority?: number;
  surfaceLayer?: number;
  onReady?: () => void;
  onLoadingChange?: (isLoading: boolean) => void;
  onNavigationStart?: () => void;
  onLoadError?: (failure: EmbeddedWebviewFailure) => void;
};

type SharedSurface = SharedEmbeddedWebviewProps & {
  id: string;
  element: HTMLDivElement;
  order: number;
  forwardedRef: React.ForwardedRef<EmbeddedWebviewElement>;
};

type SharedWebviewRegistry = {
  register: (surface: SharedSurface) => void;
  unregister: (id: string) => void;
};

type SurfaceBounds = {
  display: 'flex' | 'none';
  height: number;
  left: number;
  top: number;
  width: number;
};

const HIDDEN_BOUNDS: SurfaceBounds = {
  display: 'none',
  height: 0,
  left: 0,
  top: 0,
  width: 0,
};

const SharedWebviewContext = createContext<SharedWebviewRegistry | null>(null);

function shouldIgnoreLoadFailure(event: EmbeddedWebviewFailureEvent) {
  return event.errorCode === -3 || event.isMainFrame === false;
}

function assignForwardedRef(
  forwardedRef: React.ForwardedRef<EmbeddedWebviewElement>,
  value: EmbeddedWebviewElement | null,
) {
  if (typeof forwardedRef === 'function') {
    forwardedRef(value);
  } else if (forwardedRef) {
    forwardedRef.current = value;
  }
}

function measureSurface(element: HTMLDivElement | null): SurfaceBounds {
  if (!element || !element.isConnected) return HIDDEN_BOUNDS;
  const computed = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  if (
    computed.display === 'none'
    || computed.visibility === 'hidden'
    || rect.width < 1
    || rect.height < 1
  ) {
    return HIDDEN_BOUNDS;
  }
  return {
    // Electron's guest iframe fills the WebView host through flex layout.
    // A block host leaves the guest at its intrinsic height and produces a
    // blank lower region even when the measured host bounds are correct.
    display: 'flex',
    height: rect.height,
    left: rect.left,
    top: rect.top,
    width: rect.width,
  };
}

export function SharedEmbeddedWebviewProvider({ children }: { children: ReactNode }) {
  const webviewRef = useRef<EmbeddedWebviewElement | null>(null);
  const surfacesRef = useRef(new Map<string, SharedSurface>());
  const [surfacesRevision, setSurfacesRevision] = useState(0);
  const [bounds, setBounds] = useState<SurfaceBounds>(HIDDEN_BOUNDS);

  const registry = useMemo<SharedWebviewRegistry>(() => ({
    register(surface) {
      surfacesRef.current.set(surface.id, surface);
      setSurfacesRevision((current) => current + 1);
    },
    unregister(id) {
      surfacesRef.current.delete(id);
      setSurfacesRevision((current) => current + 1);
    },
  }), []);

  const activeSurface = useMemo(() => {
    return [...surfacesRef.current.values()]
      .filter((surface) => surface.active !== false)
      .sort((left, right) => {
        const priorityDifference = (right.surfacePriority || 0) - (left.surfacePriority || 0);
        return priorityDifference || right.order - left.order;
      })[0] || null;
  }, [surfacesRevision]);

  useLayoutEffect(() => {
    const updateBounds = () => setBounds(measureSurface(activeSurface?.element || null));
    updateBounds();
    if (!activeSurface?.element) return undefined;

    const observer = new ResizeObserver(updateBounds);
    observer.observe(activeSurface.element);
    window.addEventListener('resize', updateBounds);
    window.addEventListener('scroll', updateBounds, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateBounds);
      window.removeEventListener('scroll', updateBounds, true);
    };
  }, [activeSurface]);

  useEffect(() => {
    for (const surface of surfacesRef.current.values()) {
      assignForwardedRef(surface.forwardedRef, surface.id === activeSurface?.id ? webviewRef.current : null);
    }
    return () => {
      if (activeSurface) assignForwardedRef(activeSurface.forwardedRef, null);
    };
  }, [activeSurface]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !activeSurface) return undefined;

    const handleReady = () => activeSurface.onReady?.();
    const handleStart = () => {
      activeSurface.onNavigationStart?.();
      activeSurface.onLoadingChange?.(true);
    };
    const handleStop = () => activeSurface.onLoadingChange?.(false);
    const handleFailure = (rawEvent: Event) => {
      const event = rawEvent as EmbeddedWebviewFailureEvent;
      if (shouldIgnoreLoadFailure(event)) return;
      activeSurface.onLoadingChange?.(false);
      activeSurface.onLoadError?.({
        errorCode: Number(event.errorCode || 0),
        errorDescription: event.errorDescription || '嵌入页面加载失败',
        validatedURL: event.validatedURL || '',
        isMainFrame: event.isMainFrame !== false,
      });
    };

    webview.addEventListener('dom-ready', handleReady);
    webview.addEventListener('did-start-loading', handleStart);
    webview.addEventListener('did-stop-loading', handleStop);
    webview.addEventListener('did-fail-load', handleFailure);
    return () => {
      webview.removeEventListener('dom-ready', handleReady);
      webview.removeEventListener('did-start-loading', handleStart);
      webview.removeEventListener('did-stop-loading', handleStop);
      webview.removeEventListener('did-fail-load', handleFailure);
    };
  }, [activeSurface]);

  return (
    <SharedWebviewContext.Provider value={registry}>
      {children}
      <webview
        ref={(node: HTMLElement | null) => {
          webviewRef.current = node as EmbeddedWebviewElement | null;
          if (activeSurface) assignForwardedRef(activeSurface.forwardedRef, webviewRef.current);
        }}
        src={activeSurface?.src}
        partition={SHARED_EMBEDDED_WEBVIEW_PARTITION}
        allowpopups={activeSurface?.allowPopups !== false}
        data-shared-webview-host="true"
        style={{
          border: 0,
          display: bounds.display,
          height: bounds.height,
          left: bounds.left,
          minHeight: 0,
          minWidth: 0,
          overflow: 'hidden',
          position: 'fixed',
          top: bounds.top,
          width: bounds.width,
          zIndex: activeSurface?.surfaceLayer ?? 10,
        }}
      />
    </SharedWebviewContext.Provider>
  );
}

let surfaceOrder = 0;

export const SharedEmbeddedWebview = forwardRef<EmbeddedWebviewElement, SharedEmbeddedWebviewProps>(
  function SharedEmbeddedWebview(props, forwardedRef) {
    const registry = useContext(SharedWebviewContext);
    const reactId = useId();
    const surfaceId = useMemo(() => `shared-webview-surface-${reactId}`, [reactId]);
    const orderRef = useRef(++surfaceOrder);
    const placeholderRef = useRef<HTMLDivElement | null>(null);
    const surfaceRef = useRef<SharedSurface | null>(null);

    const setPlaceholderRef = useCallback((element: HTMLDivElement | null) => {
      placeholderRef.current = element;
    }, []);

    if (surfaceRef.current) {
      Object.assign(surfaceRef.current, props, { forwardedRef });
    }

    useEffect(() => {
      if (!registry || !placeholderRef.current) return undefined;
      const surface: SharedSurface = {
        ...props,
        element: placeholderRef.current,
        forwardedRef,
        id: surfaceId,
        order: orderRef.current,
      };
      surfaceRef.current = surface;
      registry.register(surface);
      return () => {
        surfaceRef.current = null;
        registry.unregister(surfaceId);
      };
    }, [
      forwardedRef,
      props.active,
      props.allowPopups,
      props.src,
      props.surfaceLayer,
      props.surfacePriority,
      registry,
      surfaceId,
    ]);

    if (!registry) throw new Error('SharedEmbeddedWebview must be used inside SharedEmbeddedWebviewProvider');

    return (
      <div
        ref={setPlaceholderRef}
        className={props.className}
        style={props.style}
        data-shared-webview-surface={surfaceId}
      />
    );
  },
);
