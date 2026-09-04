#!/usr/bin/env python3

import argparse
import os
import time

from faster_whisper import WhisperModel


def main():
    parser = argparse.ArgumentParser(
        description="Transcribe audio/video using Faster Whisper"
    )

    parser.add_argument(
        "-i",
        "--input",
        required=True,
        help="Input audio/video file"
    )

    parser.add_argument(
        "-m",
        "--model",
        default="base",
        choices=["tiny", "base", "small", "medium", "large-v3"],
        help="Whisper model (default: base)"
    )

    parser.add_argument(
        "--cpu",
        action="store_true",
        help="Use CPU instead of CUDA"
    )

    args = parser.parse_args()

    if not os.path.isfile(args.input):
        raise FileNotFoundError(f"File not found: {args.input}")

    device = "cpu" if args.cpu else "cuda"
    compute_type = "int8" if device == "cpu" else "float16"

    print(f"Loading model '{args.model}' on {device}...\n")

    start = time.perf_counter()

    model = WhisperModel(
        args.model,
        device=device,
        compute_type=compute_type,
    )

    # Keep the transcription settings identical to your original script
    segments, info = model.transcribe(
        args.input,
        beam_size=5,
    )

    print("Language:", info.language)
    print("Probability:", f"{info.language_probability:.4f}")
    print()

    transcript = ""
    segment_count = 0

    print("=" * 80)
    print("TRANSCRIPT")
    print("=" * 80)

    for segment in segments:
        segment_count += 1
        print(f"[{segment.start:.2f} -> {segment.end:.2f}] {segment.text}")
        transcript += segment.text

    elapsed = time.perf_counter() - start

    print("\n" + "=" * 80)
    print("FULL TRANSCRIPTION")
    print("=" * 80)
    print(transcript.strip())

    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"Input File            : {args.input}")
    print(f"Model                 : {args.model}")
    print(f"Device                : {device}")
    print(f"Compute Type          : {compute_type}")
    print(f"Detected Language     : {info.language}")
    print(f"Language Confidence   : {info.language_probability:.4f}")
    print(f"Segments              : {segment_count}")
    print(f"Characters            : {len(transcript.strip())}")
    print(f"Processing Time       : {elapsed:.2f} sec")


if __name__ == "__main__":
    main()