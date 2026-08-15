/*
 * Copyright (C) 2015-present, Ant Financial Services Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * 	http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
//
// Created by Cathor on 2019/1/10.
//
#include <jni.h>
#include <time.h>
#include <android/log.h>
#define TAG "TimeConvert"
#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG,TAG ,__VA_ARGS__) // 定义LOGD类型

JNIEXPORT jlong JNICALL
Java_com_alipay_hulu_shared_event_touch_TouchEventTracker_getTimeDiffInMicron(JNIEnv *env,
                                                                              jclass type,
                                                                              jlong currentTime) {
    struct timespec time1;
    clock_gettime(CLOCK_MONOTONIC, &time1);
    jlong targetTime = time1.tv_sec * 1000000LL + time1.tv_nsec / 1000LL;
    jlong result = currentTime * 1000 - targetTime;

    return result;
}