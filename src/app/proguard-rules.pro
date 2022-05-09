#Copyright (C) 2015-present, Ant Financial Services Group
#
#Licensed under the Apache License, Version 2.0 (the "License");
#you may not use this file except in compliance with the License.
#You may obtain a copy of the License at
#
# 	http://www.apache.org/licenses/LICENSE-2.0
#
#Unless required by applicable law or agreed to in writing, software
#distributed under the License is distributed on an "AS IS" BASIS,
#WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#See the License for the specific language governing permissions and
#limitations under the License.

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
# 保留了继承自Activity、Application这些类的子类
-keep public class * extends android.app.Activity
-keep public class * extends android.app.Application
-keep public class * extends android.app.Service
-keep public class * extends android.content.BroadcastReceiver
-keep public class * extends android.content.ContentProvider
-keep public class * extends android.preference.Preference
-keep public class * extends android.view.View
-keep public class * extends android.database.sqlite.SQLiteOpenHelper{*;}
# 如果有引用android-support-v4.jar包，可以添加下面这行
-keep public class com.null.test.ui.fragment.** {*;}
#如果引用了v4或者v7包
-dontwarn android.support.**

# AndroidX 方法类
#-keep class com.google.android.material.** {*;}
#-keep class androidx.** {*;}
-keep public class * extends androidx.**
-keep interface androidx.** {*;}
-dontwarn com.google.android.material.**
-dontnote com.google.android.material.**
-dontwarn androidx.**
# 保留Activity中的方法参数是view的方法，
-keepclassmembers class * extends android.app.Activity {
public void * (android.view.View);
}
# 枚举类不能被混淆
-keepclassmembers enum * {
public static **[] values();
public static ** valueOf(java.lang.String);
}

-keep enum ** {*;}
# 保留自定义控件(继承自View)不能被混淆
-keep public class * extends android.view.View {
public <init>(android.content.Context);
public <init>(android.content.Context, android.util.AttributeSet);
public <init>(android.content.Context, android.util.AttributeSet, int);
public void set*(***);
*** get* ();
}
# 保留Parcelable序列化的类不能被混淆
-keep class * implements android.os.Parcelable{
public static final android.os.Parcelable$Creator *;
}
# 保留Serializable 序列化的类不被混淆
-keepclassmembers class * implements java.io.Serializable {
static final long serialVersionUID;
private static final java.io.ObjectStreamField[] serialPersistentFields;
!static !transient <fields>;
private void writeObject(java.io.ObjectOutputStream);
private void readObject(java.io.ObjectInputStream);
java.lang.Object writeReplace();
java.lang.Object readResolve();
}
# 对R文件下的所有类及其方法，都不能被混淆
-keepclassmembers class **.R$* {
*;
}
# 对于带有回调函数onXXEvent的，不能混淆
-keepclassmembers class ** {
void *(**On*Event);
}
#实体类
-keep class com.alipay.hulu.bean.** { *; }

#Patch相关类
-keep class com.alipay.hulu.upgrade.PatchResponse { *; }
-keep class com.alipay.hulu.upgrade.PatchResponse$DataBean { *; }

#内部方法
-keepattributes EnclosingMethod
#==================================【三方配置】==================================
#环信混淆--------------------------------------------
-keep class org.apache.** {*;}
#okhttp
# JSR 305 annotations are for embedding nullability information.
-dontwarn javax.annotation.**

# A resource is loaded with a relative path so the package of this class must be preserved.
-keepnames class okhttp3.internal.publicsuffix.PublicSuffixDatabase

# Animal Sniffer compileOnly dependency to ensure APIs are compatible with older versions of Java.
-dontwarn org.codehaus.mojo.animal_sniffer.*

# OkHttp platform used only on JVM and when Conscrypt dependency is available.
-dontwarn okhttp3.internal.platform.ConscryptPlatform


#Github Replease
-keep class com.alipay.hulu.bean.GithubReleaseBean { *; }
-keep class com.alipay.hulu.bean.GithubReleaseBean$AuthorBean { *; }
-keep class com.alipay.hulu.bean.GithubReleaseBean$AssetsBean { *; }
-keep class com.alipay.hulu.bean.GithubReleaseBean$AssetsBean$UploaderBean { *; }

# 三方库
-keep class com.cgutman.adblib.** {*;}
-keep class com.mdit.library.** {*;}
-keep class com.android.permission.** {*;}
-keep class com.codebutler.android_websockets.** {*;}


-keepattributes Exceptions,InnerClasses,Signature

#fastjson
-dontwarn com.alibaba.fastjson.**
-keep class com.alibaba.fastjson.** { *; }

# 性能数据上报混淆
-keep class com.alipay.hulu.util.RecordUtil$RecordUploadData { *; }
-keep class com.alipay.hulu.util.RecordUtil$UploadData { *; }

# fresco
-dontwarn javax.annotation.**
#保留混淆mapping文件
-printmapping build/outputs/mapping/mapping.txt

-keepnames class * extends android.view.View
-keep class * extends android.app.Fragment {
public void setUserVisibleHint(boolean);
public void onHiddenChanged(boolean);
public void onResume();
public void onPause();
}
-keep class android.support.v4.app.Fragment {
public void setUserVisibleHint(boolean);
public void onHiddenChanged(boolean);
public void onResume();
public void onPause();
}
-keep class * extends android.support.v4.app.Fragment {
public void setUserVisibleHint(boolean);
public void onHiddenChanged(boolean);
public void onResume();
public void onPause();
}