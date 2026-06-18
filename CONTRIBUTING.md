# Contributing to printjob-llm-webcam-monitor

Thanks for your interest in improving this project! It's an open-source tool for
detecting and troubleshooting 3D-print failures with local vision models, and contributions
of all kinds are welcome — code, docs, model tuning, test images, and bug reports.

By participating you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

You don't have to write code to help. Useful contributions include:

- **Test images** — real photos of prints (healthy and failed) help us tune prompts and
  benchmark models. A shared, labeled image set is one of the most valuable things you
  can offer.
- **Prompt & schema tuning** — improving accuracy on small models (see `src/ai/prompts.ts`).
- **New camera sources** — implement the `CaptureSource` interface in `src/capture/`.
- **New vision backends** — implement the `VisionProvider` interface in `src/ai/`.
- **Docs** — setup guides for specific printers/cameras (OctoPrint, Klipper/Mainsail, Wyze, etc.).
- **Bug reports & feature ideas** — open an issue.

## Contribution roles

To keep the project healthy and welcoming, we recognize the following roles. Roles are
about responsibility, not status — anyone can grow into one by showing up consistently.

| Role            | What they do                                                                                  | How you get there |
|-----------------|-----------------------------------------------------------------------------------------------|-------------------|
| **Contributor** | Anyone who opens an issue or PR. No commitment required.                                       | Open a PR or issue |
| **Reviewer**    | Trusted to review and approve PRs in an area (e.g. capture sources, prompts, frontend).        | A track record of quality PRs/reviews; invited by a maintainer |
| **Maintainer**  | Merge rights, triages issues, cuts releases, sets technical direction, mentors contributors.   | Sustained, high-trust involvement; invited by existing maintainers by consensus |
| **Project lead**| Final say on scope and roadmap, owns the repo and release keys, resolves disputes.             | Currently [@amosroger91](https://github.com/amosroger91) |

Area ownership lives in [CODEOWNERS](.github/CODEOWNERS) where applicable. If you'd like to
take ownership of an area (a camera integration, a model backend, the dashboard), say so in
an issue — we're actively looking for area reviewers.

## Development setup

```bash
git clone https://github.com/amosroger91/printjob-llm-webcam-monitor.git
cd printjob-llm-webcam-monitor
npm install
ollama pull gemma3:4b   # or any vision model
npm run dev
```

Useful scripts:

```bash
npm run dev      # watch mode (tsx)
npm run smoke    # end-to-end pipeline test against your local model
npm run build    # typecheck + compile to dist/
```

## Pull request workflow

1. **Open an issue first** for anything non-trivial so we can agree on the approach.
2. Fork and create a branch: `git checkout -b feat/short-description`.
3. Keep PRs focused — one logical change per PR.
4. Make sure it builds clean: `npm run build` (must pass with no TypeScript errors).
5. If you touched the analysis or model path, run `npm run smoke` and mention the result.
6. Match the existing style: TypeScript, ES modules, no new heavy dependencies without
   discussion, and a comment explaining *why* for any non-obvious logic.
7. Write a clear PR description: what changed, why, and how you tested it.

## Coding guidelines

- **Stay model-agnostic and camera-agnostic.** New functionality should go behind the
  `VisionProvider` / `CaptureSource` interfaces, not hard-code a model or camera.
- **Optimize for small local models.** Favor structured output, narrow questions, and
  preprocessing over asking a model to do more. If a change makes the default `gemma3:4b`
  experience worse, it probably belongs behind a config flag.
- **No telemetry, no phoning home.** Privacy is a core promise of this project — images
  and data must stay local unless the user explicitly opts into a remote backend.
- **Keep it easy to run.** Avoid native build steps and database servers.

## Reporting bugs

Open an issue with: your OS, Node version, the model you're using, your `camera.type`,
the steps to reproduce, and what you expected vs. saw. Logs from the terminal and a sample
image (if you can share one) help a lot.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
