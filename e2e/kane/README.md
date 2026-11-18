# End-to-end (e2e) tests for web

Browser tests written in plain English for [Kane CLI](https://www.testmuai.com/kane-cli/).

| Test | What it covers |
|---|---|
| `browse_test.md` | Home feed, Library counts, opening a folder, and liking a post |
| `collection_test.md` | Creating a collection from a post's bookmark and opening it |

## Run

The tests expect a fresh database and a gallery with two folders: `beach-trip` with 3 images and `garden` with 2 images. Put them under `data/gallery/`, then start Foldergram on port 4141:

```bash
docker compose up -d
npm install -g @testmuai/kane-cli
kane-cli login
kane-cli testmd run e2e/kane/browse_test.md
```

Clear `data/db`, `data/thumbnails` and `data/previews` before each run to reset likes and collections.
