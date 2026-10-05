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
      plugins/epatrimoniu-graph-viewer.json
      media/js/views/components/plugins/epatrimoniu-graph-viewer.js
      templates/views/components/plugins/epatrimoniu-graph-viewer.htm
  → iframe
      media/epatrimoniu-viewer/ePatrimoniu_Graph_Viewer_v1.10.3.html
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

## Folders

This install has two different folders. The hyphen and the underscore are not the same directory.

```
/home/arches-admin/heritage-project/          ← outer folder. manage.py is here.
  manage.py                                   ← run the commands below from this folder
  heritage_project/                           ← inner folder. apps.py and settings.py are here.
    apps.py
    settings.py
    plugins/
    media/
    templates/
    staticfiles/                              ← collectstatic writes here. Do not copy files into it.
```

`heritage-project` is only the place you run `manage.py`, `npm`, and `collectstatic`.
Every plugin file goes into `heritage_project`.

## What to copy

Copy from this repository’s `ArchesPlugin/` into the inner folder. On the server that folder is `/home/arches-admin/heritage-project/heritage_project/`.

- `plugins/epatrimoniu-graph-viewer.json`
  → `heritage_project/plugins/epatrimoniu-graph-viewer.json`
- `media/js/views/components/plugins/epatrimoniu-graph-viewer.js`
  → `heritage_project/media/js/views/components/plugins/epatrimoniu-graph-viewer.js`
- `templates/views/components/plugins/epatrimoniu-graph-viewer.htm`
  → `heritage_project/templates/views/components/plugins/epatrimoniu-graph-viewer.htm`
- `media/epatrimoniu-viewer/` (the whole folder, including the HTML viewer)
  → `heritage_project/media/epatrimoniu-viewer/`

Do not copy `Viewer/`, `Sync/`, or `Models/`.
Do not put these files next to `manage.py` in `heritage-project`.
Do not copy them by hand into `heritage_project/staticfiles/`. `collectstatic` fills that folder.

## Register

Run these from the outer folder, `/home/arches-admin/heritage-project/` (the one that contains `manage.py`). The `--source` path starts with the inner folder name, `heritage_project`:

```bash
python manage.py plugin register --source heritage_project/plugins/epatrimoniu-graph-viewer.json
npm run build_development
python manage.py collectstatic
python manage.py plugin list
```

Answer `yes` when `collectstatic` asks to overwrite. That copies the viewer HTML from `heritage_project/media/epatrimoniu-viewer/` into `heritage_project/staticfiles/epatrimoniu-viewer/`.

Sign in to Arches. **ePatrimoniu Graph Viewer** appears in the main navigation.

After a later change to the JSON file, run this from the same outer folder:

```bash
python manage.py plugin update --source heritage_project/plugins/epatrimoniu-graph-viewer.json
```

After a later change to `epatrimoniu-graph-viewer.js`, run `npm run build_development` and `python manage.py collectstatic` again from the outer folder, then refresh the browser. A change that only touches files in `heritage_project/media/epatrimoniu-viewer/` needs `collectstatic` and a browser refresh.
