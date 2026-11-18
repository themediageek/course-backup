# Course backup site

This site puts a password-protected, read-only copy of a Canvas course on GitHub Pages, so students can keep reading course materials while Canvas is down. Faculty load their course export (an .imscc file), preview it, and click "Make it live". The page also builds an Excel submission tracker that stays on the faculty member's own computer.

Everything happens in a web browser, and nothing needs installing. The export never leaves your computer, because the page locks the course with its password before sending it to GitHub.

## Set up your site (first time only)

1. Make a free account at [github.com](https://github.com/signup) if you do not have one. Use an account that you use for nothing else, because sites on one account share a web address.
2. Open the [publish page](https://romanf88-arch.github.io/course-backup-site/publish/) and click "Connect to GitHub".
3. Click "Make your course site". GitHub copies this repository into your account under the name `course-backup`, as a public repository. Every course you upload is encrypted, so a public repository is safe.
4. Click "Open GitHub's key form", pick `course-backup` under "Repository access", generate the key, and paste it into the publish page.
5. Turn on GitHub Pages when the page asks: in your repository's Pages settings, deploy from the `main` branch and the `/ (root)` folder.

Your courses then live at `https://your-name.github.io/course-backup/<course>/`. Each time you make a course live, the page also copies its current version of the site's code into your repository, so your site gets fixes without extra steps.

The [help page](https://romanf88-arch.github.io/course-backup-site/help/) explains publishing a course, sending the link to students, replacing or taking down a course, the submission tracker, and size limits.

## What students see

Students see the course home page, the modules in your order, pages, files, links, and the instructions for assignments and discussions, with due dates, points, and rubrics. Quizzes show their title and instructions only.

The site leaves out quiz questions and answers, anything unpublished, locked files, and hidden files that no page links to. It holds no student records: no submissions, grades, or discussion replies.

## How it protects the course

- Each course is encrypted with AES-256-GCM. The password decrypts the course key through PBKDF2-SHA256 with 600,000 rounds.
- File names, page titles, and page text are encrypted too. Only the course title and the folder name are readable on GitHub.
- Course HTML is cleaned before it is shown, so nothing in a course can run scripts on the site.
- The GitHub key is sent only to `api.github.com`, and the page keeps it for the browser session unless the faculty member asks it to remember the key on that computer.
- The submission tracker is saved only to your computer and never goes to GitHub.

## For developers

The site is plain JavaScript modules with no build step. The shared library is in `app/lib/`, the course viewer in `app/viewer/`, the publish page in `publish/` (its GitHub API client is `publish/github-api.js`), and the service worker that decrypts files is `sw.js`. `node tools/mock-github.mjs` runs the publish page against a local stand-in for GitHub (add `--pages-off` to try the first-time setup).

`site-files.json` lists the files the publish page copies into a faculty member's repository. After you add, rename, or remove a site file, commit it and run `node tools/site-manifest.mjs`; a test fails while the list is out of date.

```bash
npm install
npm test
node tools/serve.mjs
```

`npm run vendor` copies the pinned browser builds of zip.js, DOMPurify, ExcelJS, and the Atkinson Hyperlegible font into `vendor/`. `node tools/pack-local.mjs <export.imscc> <folder> --password "..."` packs a course from the command line. Tests that use real exports read their paths from `tests/fixtures.local.json`, which is not in the repository, and skip when it is missing.

## License

MIT. Third-party files in `vendor/` keep their own licenses (`vendor/licenses/`). The suggested passwords use the EFF short word list (CC BY 3.0 US, Electronic Frontier Foundation).
