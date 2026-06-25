import Foundation
import Vision
import AppKit

let path = CommandLine.arguments[1]
guard let img = NSImage(contentsOfFile: path),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("cannot load image\n".data(using:.utf8)!); exit(1)
}
let W = Double(cg.width), H = Double(cg.height)
let req = VNRecognizeTextRequest { request, _ in
    guard let obs = request.results as? [VNRecognizedTextObservation] else { return }
    var lines:[String]=[]
    for o in obs {
        guard let t = o.topCandidates(1).first else { continue }
        let b = o.boundingBox  // normalized, origin bottom-left
        let x = b.minX*W, y = (1-b.maxY)*H, w = b.width*W, h = b.height*H
        lines.append("\(t.string)\t\(Int(x))\t\(Int(y))\t\(Int(w))\t\(Int(h))")
    }
    print(lines.joined(separator:"\n"))
}
req.recognitionLevel = .accurate
req.usesLanguageCorrection = false
req.recognitionLanguages = ["zh-Hans","en"]
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
try? handler.perform([req])
