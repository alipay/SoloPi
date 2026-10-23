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
package com.alipay.hulu.shared.display.items.data;

import android.os.Parcel;
import android.os.Parcelable;
import android.view.accessibility.AccessibilityNodeInfo;

public class EventsResponseType implements Parcelable {

	AccessibilityNodeInfo node;

	String operation;

	long clickDate = 0;
	long responsDate = 0;
	long refreshDate = 0;

	
	public static final Parcelable.Creator<EventsResponseType> CREATOR = new Creator<EventsResponseType>() {
		  
        @Override
        public EventsResponseType[] newArray(int size) {
            return new EventsResponseType[size];
        }
  
        @Override
        public EventsResponseType createFromParcel(Parcel source) {
        	EventsResponseType result = new EventsResponseType();
        	result.node = source.readParcelable(AccessibilityNodeInfo.class.getClassLoader());
			result.operation = source.readString();
            result.clickDate = source.readLong();
            result.responsDate = source.readLong();
            result.refreshDate = source.readLong();
            return result;
        }
    };
	
	
	public AccessibilityNodeInfo getNode() {
		return node;
	}

	public void setNode(AccessibilityNodeInfo node) {
		this.node = node;
	}

	public long getClickDate() {
		return clickDate;
	}

	public void setClickDate(long clickDate) {
		this.clickDate = clickDate;
	}

	public long getResponsDate() {
		return responsDate;
	}

	public void setResponsDate(long responsDate) {
		this.responsDate = responsDate;
	}

	public long getRefreshDate() {
		return refreshDate;
	}

	public void setRefreshDate(long refreshDate) {
		this.refreshDate = refreshDate;
	}

	public String getOperation() {
		return operation;
	}

	public void setOperation(String operation) {
		this.operation = operation;
	}

	@Override
	public int describeContents() {
		// TODO Auto-generated method stub
		return 0;
	}

	@Override
	public void writeToParcel(Parcel dest, int flags) {
		dest.writeParcelable(node, PARCELABLE_WRITE_RETURN_VALUE);
		dest.writeString(operation);
        dest.writeLong(clickDate);
        dest.writeLong(responsDate);
        dest.writeLong(refreshDate);;
	}

}
