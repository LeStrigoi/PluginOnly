# ePatrimoniu Graph Viewer — Arches plugin

An Arches navigation page that shows the existing graph viewer. It does not
rewrite the visualization and it does not modify Arches core.

No config file sets an Arches URL. On the Arches page, `arches.urls` already
contains this server’s graph routes. The browser sends the current login
session with those requests.

## How it runs

```
Arches menu
  → Knockout plugin page
      plugins/epatimoniu-graph-viewer.json
      media/js/views/components/plugins/epatimoniu-graph-viewer.js
      templates/views/components/plugins/epatimoniu-graph-viewer.htm
  → iframe
      media/epatimoniu-viewer/ePatrimoniu_Graph_Viewer_v1.10.3.html
  → same viewer scripts and styles
      arches-graph-client.js   GET /{locale}/graphs and /{locale}/graphs/{id}?cards=false
      viewer-app.js             normalizeGraph → renderGraph → buildLayout → draw
      viewer.css
```

Arches only accepts a Knockout component as a menu page, so the component’s
only job is to open the HTML viewer. The HTML file is the same viewer shell
used by the standalone app.

`arches.urls` is not a file in this repository. Arches creates that JavaScript
object from its own URL routes (`graphs_api`, `get_graph_models_api`) and
passes it into the plugin.

## What to copy

Copy these paths into the Arches project, keeping the folder names:

- `plugins/epatimoniu-graph-viewer.json`
- `media/js/views/components/plugins/epatimoniu-graph-viewer.js`
- `templates/views/components/plugins/epatimoniu-graph-viewer.htm`
- `media/epatimoniu-viewer/`

Do not copy `Viewer/`, `Sync/`, or `Models/`.

## Register

From the Arches project:

```bash
python manage.py plugin register --source path/to/plugins/epatimoniu-graph-viewer.json
npm run build_development
python manage.py plugin list
```

Sign in to Arches. **ePatrimoniu Graph Viewer** appears in the main navigation.

After a later change to the JSON file:

```bash
python manage.py plugin update --source path/to/plugins/epatimoniu-graph-viewer.json
```
