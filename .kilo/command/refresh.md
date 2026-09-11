---
description: Clean-rebuild the Jekyll site and restart the dev server
---
Stop the running Jekyll dev server, remove the `.jekyll-cache` and `_site` directories, run a clean `bundle exec jekyll build`, then restart the server on port 8080 (`bundle exec jekyll serve --livereload --incremental --host 0.0.0.0 --port 8080`) as a tracked background process and verify it is ready. No code changes; this only refreshes the build output.