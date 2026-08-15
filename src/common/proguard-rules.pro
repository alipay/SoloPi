# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

-keep class com.alipay.hulu.common.utils.ClassUtil$PatchVersionInfo { *; }
-keep class com.alipay.hulu.common.utils.patch.PatchDescription {*;}

-keep class com.alipay.hulu.common.utils.DeviceInfoUtil {*;}
-keep class com.alipay.hulu.common.utils.Callback {*;}
-keep class com.alipay.hulu.common.utils.LogUtil {*;}
# injector
-keepclassmembers class ** {
@com.alipay.hulu.common.injector.param.Subscriber <methods>;
}
-keepclassmembers class ** {
@com.alipay.hulu.common.injector.provider.Provider <methods>;
}
# ActionProvider
-keep @com.alipay.hulu.common.annotation.Enable class *

# SchemeResolver
-keep interface com.alipay.hulu.common.scheme.SchemeActionResolver { *; }
-keep @com.alipay.hulu.common.scheme.SchemeResolver class * implements com.alipay.hulu.common.scheme.SchemeActionResolver { *; }

-keep class com.alipay.hulu.common.bean.** {*;}

-keep interface com.alipay.hulu.common.tools.AbstCmdLine {*;}

-keep class com.alipay.hulu.common.utils.patch.PatchContext {*;}

# Glide
-keep class com.alipay.hulu.common.utils.Glide* { *; }

-keep public class * implements com.bumptech.glide.module.GlideModule
-keep public class * extends com.bumptech.glide.module.AppGlideModule
-keep public enum com.bumptech.glide.load.ImageHeaderParser$** {
  **[] $VALUES;
  public *;
}

-keep @interface com.alipay.hulu.common.trigger.Trigger { *; }
-keep @com.alipay.hulu.common.trigger.Trigger class ** implements java.lang.Runnable {
public void run();
}

-keep interface com.alipay.hulu.common.service.base.ExportService { *; }
-keep @interface com.alipay.hulu.common.service.base.LocalService {*;}
-keep class com.alipay.hulu.common.utils.patch.PatchClassLoader {
public com.alipay.hulu.common.utils.patch.PatchContext getContext();
}
-keep class ** implements com.alipay.hulu.common.service.base.ExportService { *; }

-keep interface ** extends com.alipay.hulu.common.service.base.ExportService { *; }

-keep interface com.alipay.hulu.common.service.base.AppGuardian { *; }
-keep @interface com.alipay.hulu.common.service.base.AppGuardian$AppGuardianEnable { *; }
-keep enum com.alipay.hulu.common.service.base.AppGuardian$ReceiveSystemEvent { *; }
-keep @interface com.alipay.hulu.common.service.base.LocalService {*;}