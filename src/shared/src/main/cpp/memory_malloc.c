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
#include <jni.h>
#include <stdlib.h>
#include <string.h>
/* Header for class com_alipay_hulu_shared_display_items_MemoryTools */
/*
 * Class:     com_alipay_hulu_shared_display_items_MemoryTools
 * Method:    fillMemory
 * Signature: (I)I
 */

static int** memory_list = NULL;
static int current_size = 0;

/**
 * 声明内存，每块1MB
 * @param env
 * @param clz
 * @param param 多少MB
 * @return
 */
jint Java_com_alipay_hulu_shared_display_items_MemoryTools_fillMemory(JNIEnv *env, jclass clz,
                                                                      jint param) {
    int mb_per_int = 1024 / sizeof(int) * 1024;
    memory_list = (int **) malloc(param * sizeof(int *));
    int i;
    for (i = 0; i < param; ++i) {
        int* p = (int *) malloc(mb_per_int * sizeof(int));

        if (p != NULL) {
            memset(p, 2, 1024 * 1024);
            memory_list[i] = p;
        } else {
            // 无法继续申明内存
            break;
        }
    }
    current_size = i;

    return i;
}

/*
 * Class:     com_alipay_hulu_shared_display_items_MemoryTools
 * Method:    releaseMemory
 * Signature: ()I
 */
jint Java_com_alipay_hulu_shared_display_items_MemoryTools_releaseMemory(JNIEnv * env, jclass clz) {
    if (memory_list == NULL) {
        return 0;
    }

    // 每一块都得free
    for (int i = 0; i < current_size; ++i) {
        int* p = memory_list[i];
        if (p != NULL) {
            free(p);
        }

        memory_list[i] = NULL;
    }

    free(memory_list);
    memory_list = NULL;

    current_size = 0;
    return 0;
}