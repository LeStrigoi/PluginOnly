/**
 * ePatrimoniu — Arches Resource Model acquisition client
 *
 * Endpoints (Arches 8.1.x source: arches/urls.py + app/views/api/graph.py):
 *   GET {locale}/graphs                         → list GraphModel records
 *   GET {locale}/graphs/{graph_id}?cards=false  → { graph: { nodes, edges, ... } }
 *
 * Does not transform for visualization; callers pass the result through
 * extractGraph() + normalizeGraph() already in the viewer.
 */
(function (global) {
  'use strict';

  var PLACEHOLDER_UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  function trimSlash(s) {
    return String(s || '').replace(/\/+$/, '');
  }

  function textOf(v) {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') {
      return v.ro || v.en || Object.values(v).find(function (x) { return typeof x === 'string'; }) || '';
    }
    return '';
  }

  /**
   * Build client options from window.EPATRIMONIU_ARCHES and/or Arches `arches.urls`.
   */
  function resolveConfig(overrides) {
    var cfg = Object.assign({}, global.EPATRIMONIU_ARCHES || {}, overrides || {});

    if (!cfg.graphsListUrl || !cfg.graphDetailUrl) {
      var arches = cfg.arches || global.arches;
      if (arches && arches.urls) {
        var urls = arches.urls;
        if (!cfg.graphsListUrl) {
          cfg.graphsListUrl =
            urls.get_graph_models_api ||
            (urls.graphs_api
              ? String(urls.graphs_api).replace(PLACEHOLDER_UUID, '').replace(/\/+$/, '')
              : '');
        }
        if (!cfg.graphDetailUrl && urls.graphs_api) {
          var base = String(urls.graphs_api);
          cfg.graphDetailUrl = function (graphId) {
            var path = base.indexOf(PLACEHOLDER_UUID) >= 0
              ? base.replace(PLACEHOLDER_UUID, graphId)
              : trimSlash(base) + '/' + graphId;
            return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'cards=false';
          };
        }
      }
    }

    if ((!cfg.graphsListUrl || !cfg.graphDetailUrl) && cfg.baseUrl) {
      var root = trimSlash(cfg.baseUrl);
      var locale = cfg.locale || 'en';
      if (!cfg.graphsListUrl) {
        cfg.graphsListUrl = root + '/' + locale + '/graphs';
      }
      if (!cfg.graphDetailUrl) {
        cfg.graphDetailUrl = function (graphId) {
          return root + '/' + locale + '/graphs/' + graphId + '?cards=false';
        };
      }
    }

    if (typeof cfg.graphDetailUrl === 'string') {
      var template = cfg.graphDetailUrl;
      cfg.graphDetailUrl = function (graphId) {
        var path = template.indexOf('{id}') >= 0
          ? template.replace('{id}', graphId)
          : template.indexOf(PLACEHOLDER_UUID) >= 0
            ? template.replace(PLACEHOLDER_UUID, graphId)
            : trimSlash(template) + '/' + graphId;
        if (path.indexOf('cards=') < 0) {
          path += (path.indexOf('?') >= 0 ? '&' : '?') + 'cards=false';
        }
        return path;
      };
    }

    return cfg;
  }

  function isConfigured(overrides) {
    var cfg = resolveConfig(overrides);
    return !!(cfg.graphsListUrl && typeof cfg.graphDetailUrl === 'function');
  }

  async function fetchJson(url, options) {
    var opts = Object.assign(
      {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      },
      options || {}
    );

    // Cross-origin LAN baseUrl (standalone testing): include credentials only if requested.
    if (opts.credentialsCrossOrigin) {
      opts.credentials = 'include';
      delete opts.credentialsCrossOrigin;
    }

    var res = await fetch(url, opts);
    var data = null;
    var parseError = null;
    try {
      data = await res.json();
    } catch (e) {
      parseError = e;
    }
    if (!res.ok) {
      var msg =
        (data && (data.message || data.error)) ||
        ('Arches request failed: ' + res.status + ' ' + res.statusText);
      var err = new Error(msg);
      err.status = res.status;
      err.url = url;
      throw err;
    }
    if (parseError) {
      var invalid = new Error(
        'Arches response was not valid JSON (' +
          res.status +
          ' ' +
          (res.statusText || '') +
          '): ' +
          (parseError.message || 'parse failed')
      );
      invalid.status = res.status;
      invalid.url = url;
      throw invalid;
    }
    return data;
  }

  /**
   * GET /{locale}/graphs  → array of graph model summaries
   */
  async function listGraphs(overrides) {
    var cfg = resolveConfig(overrides);
    if (!cfg.graphsListUrl) {
      throw new Error('Arches graphs list URL is not configured (get_graph_models_api / graphs).');
    }
    var data = await fetchJson(cfg.graphsListUrl, {
      credentialsCrossOrigin: !!(cfg.baseUrl && cfg.credentials === 'include'),
    });
    if (!Array.isArray(data)) {
      throw new Error('Arches /graphs did not return a JSON array.');
    }
    return data
      .filter(function (g) { return g && g.graphid; })
      .map(function (g) {
        return {
          graphid: String(g.graphid),
          name: textOf(g.name) || String(g.graphid),
          isresource: !!g.isresource,
          author: g.author || '',
          subtitle: textOf(g.subtitle) || '',
        };
      });
  }

  /**
   * GET /{locale}/graphs/{id}?cards=false → raw API payload ({ graph: ... })
   */
  async function fetchGraphResponse(graphId, overrides) {
    var cfg = resolveConfig(overrides);
    if (typeof cfg.graphDetailUrl !== 'function') {
      throw new Error('Arches graph detail URL is not configured (graphs_api).');
    }
    var url = cfg.graphDetailUrl(graphId);
    return fetchJson(url, {
      credentialsCrossOrigin: !!(cfg.baseUrl && cfg.credentials === 'include'),
    });
  }

  /**
   * Returns the inner graph object (nodes/edges) from an API response or bare graph.
   * Prefer viewer extractGraph when available.
   */
  function unwrapGraph(raw) {
    if (typeof global.extractGraph === 'function') {
      return global.extractGraph(raw);
    }
    if (raw && raw.graph && !Array.isArray(raw.graph) && Array.isArray(raw.graph.nodes)) {
      return raw.graph;
    }
    if (raw && raw.graphid && Array.isArray(raw.nodes)) {
      return raw;
    }
    throw new Error('Response does not contain an Arches graph with nodes/edges.');
  }

  /**
   * Build a workspace-shaped object (compatible with window.EPATRIMONIU_WORKSPACE)
   * from the graphs list. Full graph bodies are filled lazily via fetchGraphResponse.
   */
  async function buildWorkspaceShell(overrides) {
    var cfg = resolveConfig(overrides);
    var list = await listGraphs(cfg);
    return {
      arches_base_url: cfg.baseUrl || '',
      locale: cfg.locale || '',
      synced_at: new Date().toISOString(),
      graph_count: list.length,
      catalog_count: list.length,
      sync_scope: 'arches-live',
      source: 'arches-api',
      graphs: list.map(function (g) {
        return {
          graphid: g.graphid,
          name: g.name,
          isresource: g.isresource,
          author: g.author,
          nodes: null,
          edges: null,
          graph: null,
          history: [],
          sync_status: 'live',
        };
      }),
    };
  }

  global.EPatrimoniuArchesGraphClient = {
    resolveConfig: resolveConfig,
    isConfigured: isConfigured,
    listGraphs: listGraphs,
    fetchGraphResponse: fetchGraphResponse,
    unwrapGraph: unwrapGraph,
    buildWorkspaceShell: buildWorkspaceShell,
  };
})(typeof window !== 'undefined' ? window : globalThis);
