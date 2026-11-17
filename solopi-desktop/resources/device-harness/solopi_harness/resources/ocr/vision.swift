import AppKit
import Foundation
import Vision

// Input is supplied on stdin so private screenshots are not exposed in process arguments.
let data = FileHandle.standardInput.readDataToEndOfFile()
guard let image = NSImage(data: data), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fputs("invalid image\n", stderr); exit(2)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["zh-Hans", "en-US"]
request.usesLanguageCorrection = true
do {
    try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
    let lines: [[String: Any]] = (request.results ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let b = observation.boundingBox
        return ["text": candidate.string, "confidence": candidate.confidence,
                "bounds": ["left": b.minX, "top": 1-b.maxY, "right": b.maxX, "bottom": 1-b.minY]]
    }
    let result: [String: Any] = ["lines": lines, "width": cg.width, "height": cg.height]
    let encoded = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    FileHandle.standardOutput.write(encoded)
} catch {
    fputs("recognition failed\n", stderr); exit(3)
}
