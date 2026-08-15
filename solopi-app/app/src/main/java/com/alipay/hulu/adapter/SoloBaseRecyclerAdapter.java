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
package com.alipay.hulu.adapter;

import android.content.Context;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;

import androidx.annotation.LayoutRes;
import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.alipay.hulu.common.utils.LogUtil;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;

/**
 * 通用Adapter对象
 * @param <T>
 */
public abstract class SoloBaseRecyclerAdapter<T> extends RecyclerView.Adapter<SoloBaseRecyclerAdapter.SimpleViewHolder<T>> {
    private static final String TAG = SoloBaseRecyclerAdapter.class.getSimpleName();
    protected List<T> dataList = new ArrayList<>();
    protected Context context;
    protected LayoutInflater inflater;
    protected OnItemClickListener<T> listener;
    private int layoutId;

    protected View.OnClickListener itemsOnClickListener;
    protected View.OnLongClickListener itemsOnLongClickListener;

    public SoloBaseRecyclerAdapter(Context context, @LayoutRes int layoutId) {
        this.context = context;
        this.inflater = LayoutInflater.from(context);
        this.layoutId = layoutId;

        this.itemsOnClickListener = new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Integer position = (Integer) v.getTag();
                if (listener != null && position != null && position >= 0 && position < dataList.size()) {
                    T data = dataList.get(position);
                    listener.onItemClick(data, position);
                }
            }
        };

        this.itemsOnLongClickListener = new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View v) {
                Integer position = (Integer) v.getTag();
                if (listener != null && position != null && position >= 0 && position < dataList.size()) {
                    T data = dataList.get(position);
                    return listener.onItemLongClick(data, position);
                }

                return false;
            }
        };

    }

    /**
     * 更新数据
     * @param newData
     */
    public void updateDate(List<T> newData) {
        dataList.clear();
        if (newData != null) {
            dataList.addAll(newData);
        }
        notifyDataSetChanged();
    }

    /**
     * 添加数据
     * @param data
     */
    public void addItem(T data) {
        if (data != null) {
            dataList.add(data);
            notifyItemInserted(dataList.size());
        }
    }

    /**
     * 删除对象
     * @param index
     */
    public void deleteItem(int index) {
        dataList.remove(index);
        notifyItemRemoved(index);
    }

    /**
     * 获取对象数量
     * @return
     */
    public int getCount() {
        return dataList.size();
    }

    /**
     * 获取所有对象
     * @return
     */
    public List<T> getAllData() {
        return new ArrayList<>(dataList);
    }

    /**
     * 生成ViewHolder
     * @param view
     * @return
     */
    public abstract SimpleViewHolder<T> generateViewHolder(View view);

    @NonNull
    @Override
    public SimpleViewHolder<T> onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View v = inflater.inflate(layoutId, parent, false);

        // 监听点击事件
        registerListener(v);
        SimpleViewHolder<T> holder = generateViewHolder(v);
        holder.setRef(this);
        return holder;
    }

    private void registerListener(View v) {
        v.setOnClickListener(itemsOnClickListener);
        v.setOnLongClickListener(itemsOnLongClickListener);
    }

    @Override
    public void onBindViewHolder(@NonNull SimpleViewHolder<T> holder, int position) {
        T data = dataList.get(position);
        holder._bindData(data, position);
    }

    @Override
    public int getItemCount() {
        return dataList.size();
    }

    /**
     * 设置事件监听器
     * @param listener
     */
    public void setItemOperationListener(OnItemClickListener<T> listener) {
        this.listener = listener;
    }

    /**
     * 简易ViewHolder对象
     * @param <K>
     */
    public static abstract class SimpleViewHolder<K> extends RecyclerView.ViewHolder {
        protected WeakReference<SoloBaseRecyclerAdapter<K>> ref;
        public SimpleViewHolder(@NonNull View itemView) {
            super(itemView);
            bindView(itemView);
        }

        public void setRef(SoloBaseRecyclerAdapter<K> adapter) {
            this.ref = new WeakReference<>(adapter);
        }

        /**
         * 删除自身数据
         */
        public void deleteSelf() {
            if (ref == null || ref.get() == null) {
                LogUtil.w(TAG, "Holder ref is null");
                return;
            }

            ref.get().deleteItem((Integer) itemView.getTag());
        }

        /**
         * 绑定View对象
         * @param base
         */
        public abstract void bindView(View base);

        public void _bindData(K data, int position) {
            itemView.setTag(position);
            bindData(data, position);
        }

        /**
         * 绑定数据
         * @param data
         */
        public abstract void bindData(K data, int index);
    }

    public interface OnItemClickListener<K> {
        void onItemClick(K data, int position);
        boolean onItemLongClick(K data, int position);
    }
}
