define([
  'knockout',
  'arches',
  'templates/views/components/plugins/epatimoniu-graph-viewer.htm'
], function (ko, arches, template) {
  /**
   * Arches navigation page for the existing ePatrimoniu viewer.
   * The visualization files are served unchanged from media/epatimoniu-viewer.
   * Graph URLs come from this host's arches.urls. Fetches stay same-origin,
   * so the browser sends the current Arches session cookie. No extra login.
   */
  const PLACEHOLDER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  function sameOriginPath(url) {
    if (!url) return '';
    try {
      const parsed = new URL(String(url), window.location.origin);
      return parsed.pathname + parsed.search;
    } catch (_) {
      return String(url);
    }
  }

  function resolveGraphUrls(archesObj) {
    const urls = (archesObj && archesObj.urls) || {};
    let listUrl = urls.get_graph_models_api || '';
    let detailTemplate = urls.graphs_api || '';

    if (!listUrl && detailTemplate) {
      listUrl = String(detailTemplate).replace(PLACEHOLDER, '').replace(/\/+$/, '');
    }
    if (!detailTemplate && listUrl) {
      detailTemplate = String(listUrl).replace(/\/+$/, '') + '/' + PLACEHOLDER;
    }

    return {
      listUrl: sameOriginPath(listUrl),
      detailTemplate: sameOriginPath(detailTemplate)
    };
  }

  function mediaUrl(path) {
    const urls = (arches && arches.urls) || {};
    const base = urls.static_url || urls.mediaurl || urls.media_url || '/media/';
    return String(base).replace(/\/?$/, '/') + String(path).replace(/^\//, '');
  }

  const ViewModel = function () {
    const self = this;
    const graphUrls = resolveGraphUrls(arches);

    if (!graphUrls.listUrl || !graphUrls.detailTemplate) {
      self.error = ko.observable(
        'This page must run inside Arches so it can read arches.urls for the graphs API.'
      );
      self.iframeSrc = ko.observable('');
      return;
    }

    self.error = ko.observable('');

    const qs = new URLSearchParams();
    qs.set('arches', '1');
    qs.set('graphs_list_url', graphUrls.listUrl);
    qs.set('graph_detail_base', graphUrls.detailTemplate);

    const viewerHtml = mediaUrl('epatimoniu-viewer/ePatrimoniu_Graph_Viewer_v1.10.3.html');
    self.iframeSrc = ko.observable(viewerHtml + '?' + qs.toString());
  };

  return ko.components.register('epatimoniu-graph-viewer', {
    viewModel: ViewModel,
    template: template
  });
});
