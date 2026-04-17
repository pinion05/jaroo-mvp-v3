import Foundation
import Vision
import AppKit

let args = CommandLine.arguments
if args.count < 2 {
  fputs("usage: apple-vision-ocr.swift <image-path>\n", stderr)
  exit(64)
}

let imageURL = URL(fileURLWithPath: args[1])

guard let image = NSImage(contentsOf: imageURL) else {
  fputs("failed to load image\n", stderr)
  exit(66)
}

guard let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let cgImage = bitmap.cgImage else {
  fputs("failed to create cgImage\n", stderr)
  exit(65)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["ko-KR", "en-US"]
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

do {
  try handler.perform([request])
  let observations = request.results ?? []
  let text = observations
    .compactMap { $0.topCandidates(1).first?.string.trimmingCharacters(in: .whitespacesAndNewlines) }
    .filter { !$0.isEmpty }
    .joined(separator: "\n")
  print(text)
} catch {
  fputs("vision error: \(error)\n", stderr)
  exit(70)
}
