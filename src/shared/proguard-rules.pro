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

# BroadcastPackage
-keep class com.alipay.hulu.shared.io.socket.LocalNetworkBroadcastService$BroadcastPackage { *; }
-keep enum com.alipay.hulu.shared.io.socket.enums.BroadcastCommandEnum { *; }

#PrepareWorker
-keep interface com.alipay.hulu.shared.node.utils.prepare.PrepareWorker { *; }
-keep @com.alipay.hulu.shared.node.utils.prepare.PrepareWorker$PrepareTool class * implements com.alipay.hulu.shared.node.utils.prepare.PrepareWorker { *; }

# greeendao
-keep class com.alipay.hulu.shared.io.bean.** {*;}
-keep class com.alipay.hulu.shared.io.db.** {*;}
### greenDAO 3
-keepclassmembers class * extends org.greenrobot.greendao.AbstractDao {
public static java.lang.String TABLENAME;
}
-keep class **$Properties

# If you do not use SQLCipher:
-dontwarn org.greenrobot.greendao.database.**
# If you do not use RxJava:
-dontwarn rx.**

-keep class com.alipay.hulu.shared.node.tree.export.bean.** {*;}
-keep class com.alipay.hulu.shared.node.action.OperationMethod {*;}
-keep class com.alipay.hulu.shared.node.tree.OperationNode {*;}
-keep class com.alipay.hulu.shared.node.tree.OperationNode$AssistantNode {*;}
-keep class com.alipay.hulu.shared.node.tree.AbstractNodeTree { *; }
-keep class com.alipay.hulu.shared.node.tree.FakeNodeTree { *; }
-keep class com.alipay.hulu.shared.node.tree.accessibility.tree.AccessibilityNodeTree { *; }
-keep class * extends com.alipay.hulu.shared.node.tree.AbstractNodeTree { *; }

-keep class ** implements com.alipay.hulu.shared.display.items.base.Displayable {
public void clear();
}
