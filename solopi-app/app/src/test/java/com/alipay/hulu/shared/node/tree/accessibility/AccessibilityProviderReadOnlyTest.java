package com.alipay.hulu.shared.node.tree.accessibility;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityEvent;

import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.shared.node.AbstractNodeProcessor;
import com.alipay.hulu.shared.node.AbstractProvider;
import com.alipay.hulu.shared.node.OperationService;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.shared.node.tree.FakeNodeTree;
import com.alipay.hulu.shared.node.tree.MetaTree;
import com.alipay.hulu.shared.node.utils.NodeContext;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;

public class AccessibilityProviderReadOnlyTest {
    private int previousLogLevel;

    @Before
    public void suppressAndroidLogStub() {
        previousLogLevel = LogUtil.LOG_LEVEL;
        LogUtil.LOG_LEVEL = Integer.MAX_VALUE;
    }

    @After
    public void restoreLogLevel() {
        LogUtil.LOG_LEVEL = previousLogLevel;
    }

    @Test
    public void missingRootReturnsWithoutServiceRecoveryOrRetries() {
        FixtureProvider provider = new FixtureProvider();
        assertNull(provider.provideMetaTree(readOnlyContext()));
        assertEquals(1, provider.windowReads);
    }

    @Test
    public void emptyRootReturnsWithoutServiceRecoveryOrRetries() {
        FixtureProvider provider = new FixtureProvider();
        provider.root = new MetaTree();
        assertNull(provider.provideMetaTree(readOnlyContext()));
        assertEquals(1, provider.windowReads);
    }

    @Test
    public void providerExceptionIsBoundedAndDoesNotRestartAccessibility() {
        FixtureProvider provider = new FixtureProvider();
        provider.fail = true;
        assertNull(provider.provideMetaTree(readOnlyContext()));
        assertEquals(1, provider.windowReads);
    }

    @Test
    public void availableRootRemainsUsableInReadOnlyMode() {
        FixtureProvider provider = new FixtureProvider();
        provider.root = new MetaTree();
        provider.root.setCurrentNode(new FakeNodeTree());
        assertSame(provider.root, provider.provideMetaTree(readOnlyContext()));
        assertEquals(1, provider.windowReads);
    }

    @Test
    public void agentCaptureContextDoesNotLeakIntoLegacyCapture() {
        CapturingService service = new CapturingService();
        service.getBaseCurrentRootForAgent();
        assertEquals(Boolean.TRUE, service.lastContext.get(AccessibilityProvider.READ_ONLY_CAPTURE));
        assertEquals(AccessibilityProvider.class, service.lastProvider);
        service.getBaseCurrentRoot();
        assertNull(service.lastContext);
    }

    private static NodeContext readOnlyContext() {
        NodeContext context = new NodeContext();
        context.put(AccessibilityProvider.READ_ONLY_CAPTURE, true);
        return context;
    }

    private static final class FixtureProvider extends AccessibilityProvider {
        // Android service methods remain unimplemented JVM stubs: calling recovery fails the test.
        final AccessibilityService service = new AccessibilityService() {
            @Override public void onAccessibilityEvent(AccessibilityEvent event) { }
            @Override public void onInterrupt() { }
        };
        int windowReads;
        boolean fail;
        MetaTree root;

        FixtureProvider() {
            setAccessibilityService(service);
        }

        @Override
        protected MetaTree getRootInWindows(NodeContext context) {
            windowReads++;
            if (fail) {
                throw new IllegalStateException("Window unavailable");
            }
            return root;
        }
    }

    private static final class CapturingService extends OperationService {
        NodeContext lastContext;
        Class<? extends AbstractProvider> lastProvider;

        @Override
        public AbstractNodeTree startLoadProvider(Class<? extends AbstractProvider> provider,
                List<Class<? extends AbstractNodeProcessor>> processors, NodeContext context) {
            lastProvider = provider;
            lastContext = context;
            return new FakeNodeTree();
        }
    }
}
