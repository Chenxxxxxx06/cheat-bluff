> It all started because Tibo kept resetting lately, so I finally built something I had wanted to make for a while.

<div align="center">
  <img src="docs/images/icon.png" width="88" alt="Cheat Bluff logo" />
  <h1>Cheat Bluff</h1>
  <p><strong>Explain your work clearly. Prepare for your next interview.</strong></p>
  <p>Personal knowledge · Interview preparation · Review</p>
  <p><a href="README.md">简体中文</a> · <strong>English</strong></p>
  <p><a href="#getting-started">Get started</a> · <a href="#pair-it-with-a-chinese-resume">Resume template</a> · <a href="#todo">TODO</a> · <a href="https://github.com/Chenxxxxxx06/cheat-bluff/issues">Open an issue</a></p>
</div>

![Cheat Bluff home screen with a fresh, empty profile](docs/images/home.png)

## What is it?

A local interview workspace for Windows. Bring together your resume, papers, code and project notes, then prepare, practice and review around a specific role.

The idea is straightforward: a calm place to keep your materials, explain your work and figure out what to improve next time.

| Before preparation | During preparation | After an interview |
| --- | --- | --- |
| Organize your resume, papers, code and notes | Add the company, role and job description | Review conversations on a timeline |
| Keep source evidence with knowledge cards | Practice answers grounded in your materials | Find records with keywords or `Ctrl+F` |

- **Your own knowledge base:** organize materials, knowledge cards and personal contributions separately, with traceable sources.
- **A focused workspace:** consistent controls, light and dark themes, system theme support and resizable panes.
- **Start from blank:** short guidance in empty conversations, editable preparation names, and record deletion with recovery.
- **Bring your own model:** configure compatible text, vision and embedding services yourself. Live speech has additional protocol requirements.
- **Local storage:** profiles, materials and records stay on your computer. When you use a cloud model, relevant inputs are sent to the service you configure.

> This clean public edition contains none of the author's credentials, accounts, knowledge base, resume or interview records. No shared model quota is provided. The screenshot uses a fresh, empty profile. You can browse the interface and manage materials without a model connection; AI answers require your own configuration.

## Getting started

This is currently a source distribution. You need **Windows, Node.js 24 and npm**.

```bash
git clone https://github.com/Chenxxxxxx06/cheat-bluff.git
cd cheat-bluff
npm ci
npm start
```

On first launch:

1. **Build your knowledge base:** create a personal profile and import your own resume and project materials.
2. **Configure a model if needed:** open “AI 与本地数据”, enter your service address, model names and credentials, then test the connection. Replace the placeholder address.
3. **Prepare an interview:** name the preparation, add the company, role and job description, and select relevant materials.
4. **Practice and review:** work through project introductions and follow-up questions; later search records, rename them and add review notes.

Text-based PDFs, Office documents, code and plain text can be imported directly. Scanned-document recognition requires a separately prepared local OCR runtime and models; these large files are not included. Live transcription uses the DashScope WebSocket protocol, which ordinary text-model services may not support.

Local data is stored separately in `%APPDATA%/CheatBluff/`. **This edition does not read the author's old data directory or the login credentials of other AI applications.**

<details>
<summary>Development, checks and packaging</summary>

```bash
npm test
npm run verify:public
npm run package:dir
```

`out/` contains the currently runnable application code; `test/` contains public-edition regression tests. Build outputs go to `dist/` and are not committed. Initial dependency installation requires internet access. Model connections and local OCR components are configured by each user.

</details>

## Pair it with a Chinese resume

Write down your experience clearly, then practice talking about it. This separate template pairs well with Cheat Bluff:

**[Chinese Resume LaTeX](https://github.com/Chenxxxxxx06/chinese-resume-latex)**

It includes Chinese typography, project entries, clickable links and logo slots. Edit your content and compile with **XeLaTeX**, or upload it to Overleaf and select XeLaTeX. You can then import your generated PDF into Cheat Bluff. This is a link to a template, not an import of anyone's personal resume.

A small suggestion, inspired by Asu: **sketch a simple logo for your project and put it in your LaTeX resume.** A clear shape that remains recognizable at small sizes is enough. Save the image under the template's `assets/` directory, for example:

```latex
\projectentry[assets/project-logo.png]
  {Your project}{Your role}{Tech stack or a one-line description}
```

A fuller guide covering consistent sizes, vector exports and resume layout examples is planned.

## TODO

- [ ] Make project explanations more conversational, with fewer stock phrases.
- [ ] Keep fixing bugs and improve edge cases and error messages.
- [ ] Improve different resolutions, display scaling and narrow-window layouts.
- [ ] Improve knowledge ownership checks, deduplication and source accuracy.
- [ ] Add connection checks and setup guidance for more model services.
- [ ] Make OCR component installation and desktop distribution easier.
- [ ] Add a complete project-logo-to-LaTeX-resume tutorial.
- [ ] Document and progressively replace recovered code; improve provenance and licensing records.

## Issues are welcome

**Questions, bug reports, ideas and suggestions are all welcome!** I will read them, take them seriously and do my best to fix reproducible problems. Discussions about making the app more useful are welcome too.

[Report a problem or share an idea →](https://github.com/Chenxxxxxx06/cheat-bluff/issues/new/choose)

Steps to reproduce, expected behavior and actual results help a lot. Please redact personal information and credentials from screenshots and logs.

---

**undestand** · This project includes modifications built on recovered code. Public visibility does not imply a single open-source license for every component. See [SOURCE_PROVENANCE](docs/SOURCE_PROVENANCE.md); existing third-party notices are retained.
