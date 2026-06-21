class DependencyAnalyzer {
  constructor(data) {
    this.data = data;
    this.serviceNames = data.services.map(s => s.name);
    this.serviceSet = new Set(this.serviceNames);
    this._adj = null;
    this._revAdj = null;
    this._inDeg = null;
    this._outDeg = null;
  }

  analyze() {
    const adjacencyList = this.buildAdjacencyList();
    const reverseAdjacencyList = this.buildReverseAdjacencyList();
    const inDegree = this.calculateInDegree();
    const outDegree = this.calculateOutDegree();
    const topoOrder = this.topologicalSort();
    const layers = this.assignLayersBFS();
    const cycles = this.detectCycles();

    return {
      adjacencyList,
      reverseAdjacencyList,
      inDegree,
      outDegree,
      topoOrder,
      layers,
      cycles,
      isDAG: cycles.length === 0
    };
  }

  buildAdjacencyList() {
    if (this._adj) return this._adj;
    const adj = {};
    this.serviceNames.forEach(name => { adj[name] = []; });
    this.data.calls.forEach(call => {
      if (!adj[call.from]) adj[call.from] = [];
      if (!adj[call.to]) adj[call.to] = [];
      adj[call.from].push({
        service: call.to,
        avgLatency: call.avgLatency,
        p99Latency: call.p99Latency,
        errorRate: call.errorRate,
        requestCount: call.requestCount,
        circuitBreaker: call.circuitBreaker || null,
        retry: call.retry || null,
        fallback: call.fallback || null
      });
    });
    this._adj = adj;
    return adj;
  }

  buildReverseAdjacencyList() {
    if (this._revAdj) return this._revAdj;
    const revAdj = {};
    this.serviceNames.forEach(name => { revAdj[name] = []; });
    this.data.calls.forEach(call => {
      if (!revAdj[call.to]) revAdj[call.to] = [];
      if (!revAdj[call.from]) revAdj[call.from] = [];
      revAdj[call.to].push({
        service: call.from,
        avgLatency: call.avgLatency,
        p99Latency: call.p99Latency,
        errorRate: call.errorRate,
        requestCount: call.requestCount,
        circuitBreaker: call.circuitBreaker || null,
        retry: call.retry || null,
        fallback: call.fallback || null
      });
    });
    this._revAdj = revAdj;
    return revAdj;
  }

  calculateInDegree() {
    if (this._inDeg) return this._inDeg;
    const inDeg = {};
    this.serviceNames.forEach(name => { inDeg[name] = 0; });
    this.data.calls.forEach(call => {
      inDeg[call.to] = (inDeg[call.to] || 0) + 1;
    });
    this._inDeg = inDeg;
    return inDeg;
  }

  calculateOutDegree() {
    if (this._outDeg) return this._outDeg;
    const outDeg = {};
    this.serviceNames.forEach(name => { outDeg[name] = 0; });
    this.data.calls.forEach(call => {
      outDeg[call.from] = (outDeg[call.from] || 0) + 1;
    });
    this._outDeg = outDeg;
    return outDeg;
  }

  topologicalSort() {
    const inDeg = { ...this.calculateInDegree() };
    const adj = this.buildAdjacencyList();
    const queue = [];
    const result = [];

    Object.entries(inDeg).forEach(([name, deg]) => {
      if (deg === 0) queue.push(name);
    });

    while (queue.length > 0) {
      const current = queue.shift();
      result.push(current);
      (adj[current] || []).forEach(neighbor => {
        inDeg[neighbor.service]--;
        if (inDeg[neighbor.service] === 0) {
          queue.push(neighbor.service);
        }
      });
    }

    if (result.length !== this.serviceNames.length) {
      return [...this.serviceNames];
    }
    return result;
  }

  assignLayersBFS() {
    const adj = this.buildAdjacencyList();
    const layers = {};
    const inDeg = { ...this.calculateInDegree() };
    const remaining = new Set(this.serviceNames);
    let currentLayer = 0;

    while (remaining.size > 0) {
      const roots = [...remaining].filter(s => inDeg[s] === 0);
      if (roots.length === 0) {
        for (const s of remaining) {
          layers[s] = currentLayer;
        }
        break;
      }
      roots.forEach(s => {
        layers[s] = currentLayer;
        remaining.delete(s);
      });
      roots.forEach(s => {
        (adj[s] || []).forEach(n => {
          inDeg[n.service]--;
        });
      });
      currentLayer++;
    }

    const maxLayer = Math.max(...Object.values(layers), 0);
    const grouped = {};
    for (let i = 0; i <= maxLayer; i++) grouped[i] = [];
    Object.entries(layers).forEach(([name, layer]) => {
      grouped[layer].push(name);
    });

    return { layers, grouped, maxLayer };
  }

  detectCycles() {
    const adj = this.buildAdjacencyList();
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = {};
    this.serviceNames.forEach(n => { color[n] = WHITE; });
    const cycles = [];

    const dfs = (u) => {
      color[u] = GRAY;
      for (const v of (adj[u] || [])) {
        if (color[v.service] === GRAY) {
          cycles.push([u, v.service]);
        } else if (color[v.service] === WHITE) {
          dfs(v.service);
        }
      }
      color[u] = BLACK;
    };

    this.serviceNames.forEach(n => {
      if (color[n] === WHITE) dfs(n);
    });
    return cycles;
  }

  getDownstreamServices(serviceName) {
    const adj = this.buildAdjacencyList();
    const visited = new Set();
    const result = [];
    const queue = [serviceName];
    visited.add(serviceName);
    while (queue.length > 0) {
      const current = queue.shift();
      for (const neighbor of (adj[current] || [])) {
        if (!visited.has(neighbor.service)) {
          visited.add(neighbor.service);
          result.push(neighbor.service);
          queue.push(neighbor.service);
        }
      }
    }
    return result;
  }

  getUpstreamServices(serviceName) {
    const revAdj = this.buildReverseAdjacencyList();
    const visited = new Set();
    const result = [];
    const queue = [serviceName];
    visited.add(serviceName);
    while (queue.length > 0) {
      const current = queue.shift();
      for (const neighbor of (revAdj[current] || [])) {
        if (!visited.has(neighbor.service)) {
          visited.add(neighbor.service);
          result.push(neighbor.service);
          queue.push(neighbor.service);
        }
      }
    }
    return result;
  }

  getEdge(from, to) {
    const adj = this.buildAdjacencyList();
    return (adj[from] || []).find(e => e.service === to) || null;
  }
}

module.exports = DependencyAnalyzer;
