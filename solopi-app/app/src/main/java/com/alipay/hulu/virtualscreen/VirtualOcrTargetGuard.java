package com.alipay.hulu.virtualscreen;

import java.util.List;

/** Conservative OCR target matching; does not perform or authorize input by itself. */
public final class VirtualOcrTargetGuard {
    public static final class Line {
        public final String id, text;
        public final VirtualActionGuard.Box bounds;
        public final boolean pixelsMatch, protectedText;
        public Line(String id, String text, VirtualActionGuard.Box bounds, boolean pixelsMatch, boolean protectedText) {
            this.id = id; this.text = text; this.bounds = bounds;
            this.pixelsMatch = pixelsMatch; this.protectedText = protectedText;
        }
    }

    public static String check(List<Line> previous, List<Line> current, String selectedId) {
        if (previous == null || current == null || selectedId == null) return "ocr_target_unavailable";
        Line selected = null;
        for (Line line : previous) {
            if (line == null || !selectedId.equals(line.id)) continue;
            if (selected != null) return "ambiguous_ocr_target";
            selected = line;
        }
        if (selected == null || selected.text == null || selected.text.trim().isEmpty()
                || selected.bounds == null || selected.protectedText || !selected.pixelsMatch) return "ocr_target_unavailable";
        int previousMatches = 0, currentMatches = 0;
        Line newTarget = null;
        for (Line line : previous) if (line != null && selected.text.equals(line.text)) previousMatches++;
        for (Line line : current) if (line != null && selected.text.equals(line.text)) { currentMatches++; newTarget = line; }
        if (previousMatches != 1 || currentMatches != 1) return "ambiguous_ocr_target";
        if (newTarget == null || newTarget.protectedText || !newTarget.pixelsMatch || !selected.bounds.equals(newTarget.bounds))
            return "stale_ocr_target";
        return null;
    }
    private VirtualOcrTargetGuard() { }
}
