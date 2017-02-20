'use strict';

// @license
// Copyright 2017 Pawel Psztyc <jarrodek@gmail.com>
// Licensed under the Apache License, Version 2.0 (the "License"); you may not
// use this file except in compliance with the License. You may obtain a copy of
// the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
// WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
// License for the specific language governing permissions and limitations under
// the License.

class DataProcessor {

  clearData() {
    this._resolveFn = undefined;
    this.servers = this.servers.map((server) => {
      delete server.response;
      delete server.error;
      delete server.dataready;
      delete server.stats;
      return server;
    });
  }

  setServers(servers) {
    this.servers = servers;
  }

  /**
   * Main function to call to request a stats data from the server.
   *
   * @return {Promise<Array>} Promise to resolve to the servers array with additional stats
   * properties.
   */
  updateData() {
    this.clearData();
    var servers = this.servers;
    if (!servers || !servers.length) {
      return Promise.resolve([]);
    }
    return this.getStats(servers)
    .then((servers) => this._perocessResponse(servers));
  }
  // Irterates over servers and for each server calls the main process to make a
  // http request for new stats.
  getStats(servers) {
    servers = servers.map((i) => {
      i.url = this.getValidUrl(i);
      return i;
    });

    var promises = servers.map((server) => this.fetchStats(server));
    return Promise.all(promises);
  }
  /**
   * Gets the data from the server.
   */
  fetchStats(server) {
    var code;
    var ok;
    return fetch(server.url)
    .then((response) => {
      code = response.status;
      ok = response.ok;
      return response.text();
    })
    .then((txt) => {
      if (!ok) {
        // if (txt) {
        //   server.error = txt;
        // } else {
        //   server.error = this._errorFromStatus(code);
        // }
        server.error = this._errorFromStatus(code);
      } else {
        server.response = txt;
      }
      return server;
    })
    .catch((e) => {
      server.error = e.message;
      return server;
    });
  }

  // Gets a valid URL to the server endpoint.
  // It checks if host has a `http(s)` prefix and adds it if not.
  getValidUrl(server) {
    var url = '';
    var host = server.host;
    if (host.indexOf('http') !== 0) {
      host = 'http://' + host;
    }
    url += host + ':' + server.port;
    url += '/admin.cgi?pass=' + server.password;
    url += '&mode=viewxml';
    return url;
  }

  /**
   * Parses XML response from the server, gets the data from it and builds the result structure
   * that will be passed to the app view.
   */
  _perocessResponse(servers) {
    servers = servers.map((server) => {
      if (server.error) {
        server.stats = this._getEmptyStats();
        return server;
      }
      let stats = this._getStats(server);
      delete server.response;
      delete server.url;
      server.stats = stats;
      return server;
    });
    return Promise.resolve(servers);
  }

  _getStats(server) {
    var doc = new window.DOMParser().parseFromString(server.response, 'application/xml');
    if (doc.body && doc.body.firstChild && doc.body.firstChild.nodeName === 'parsererror') {
      server.error = server.response;
      return this._getEmptyStats();
    }
    var currentListeners = this._getNodeNumberValue(doc, 'CURRENTLISTENERS');
    var peakListeners = this._getNodeNumberValue(doc, 'PEAKLISTENERS');
    var avgTime = this._getNodeNumberValue(doc, 'AVERAGETIME');
    var rStats = this._computeStats(doc);
    return {
      currentListeners: currentListeners,
      peakListeners: peakListeners,
      avgTime: avgTime,
      rs: {
        ru: rStats.ru,
        rat: rStats.rat
      }
    };
  }

  _getNodeNumberValue(doc, nodeName) {
    var node = doc.querySelector(nodeName);
    if (!node || node.nodeType !== 1) {
      return null;
    }
    var result = Number(node.textContent);
    if (result !== result) {
      return null;
    }
    return result;
  }

  _computeStats(doc) {
    var node = doc.querySelector('LISTENERS');
    var list = Array.from(node.querySelectorAll('LISTENER'));
    var ru = 0;
    var connectionTimes = [];
    list.forEach((listener) => {
      let host = listener.querySelector('HOSTNAME');
      if (!host) {
        return;
      }
      let value = host.textContent;
      if (!value) {
        return;
      }
      if (value.indexOf('127') === 0) {
        return;
      }
      ru ++;
      let ct = this._getNodeNumberValue(listener, 'CONNECTTIME');
      if (!ct) {
        ct = 0;
      }
      connectionTimes.push(ct);
    });
    var result = {
      ru: ru,
      rat: 0
    };
    if (connectionTimes.length > 0) {
      var sum = connectionTimes.reduce((a, b) => a + b, 0);
      result.rat = Math.round(sum / connectionTimes.length);
    }
    return result;
  }

  _getEmptyStats() {
    return {
      currentListeners: 0,
      peakListeners: 0,
      avgTime: 0,
      rs: {
        ru: 0,
        rat: 0
      }
    };
  }

  _reportData() {
    if (!this._resolveFn) {
      return;
    }
    this._resolveFn(this.servers);
    this._resolveFn = undefined;
  }

  _errorFromStatus(code) {
    switch (code) {
      case 400: return 'The request could not be understood by the server due to malformed syntax';
      case 401:
        return 'The request requires user authentication and given credentials are insufficient';
      case 403:
        return 'Forbidden: The server understood the request, but is refusing to fulfill it.';
      case 404: return 'Not Found: The server has not found anything matching the Request-URI';
      case 405: return 'Method Not Allowed';
      default: return 'Server returned with status ' + code + ' which is far away from being ok.';
    }
  }
}

var processor = new DataProcessor();
exports.processor = processor;
