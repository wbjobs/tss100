class DependencyAnalyzer {
  constructor(data) {
    this.data = data;
    this.serviceNames = data.services.map(s => s.name);
  }

  analyze() {
    const adjacencyList = this.buildAdjacencyList();
    const reverseAdjacencyList = this.buildReverseAdjacencyList();
    const inDegree = this.calculateInDegree();
    const outDegree = this.calculateOutDegree();
    const topoOrder = this.topologicalSort();
    const layers = this.assignLayers();
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
    const adj = {};
    this.serviceNames.forEach(name => {
      adj[name] = [];
    });

    this.data.calls.forEach(call => {
      if (!adj[call.from]) adj[call.from] = [];
      if (!adj[call.to]) adj[call.to] = [];
      adj[call.from].push({
        service: call.to,
        avgLatency: call.avgLatency,
        p99Latency: call.p99Latency,
        errorRate: call.errorRate,
        requestCount: call.requestCount
      });
    });

    return adj;
  }

  buildReverseAdjacencyList() {
    const revAdj = {};
    this.serviceNames.forEach(name => {
      revAdj[name] = [];
    });

    this.data.calls.forEach(call => {
      if (!revAdj[call.to]) revAdj[call.to] = [];
      if (!revAdj[call.from]) revAdj[call.from] = [];
      revAdj[call.to].push({
        service: call.from,
        avgLatency: call.avgLatency,
        p99Latency: call.p99Latency,
        errorRate: call.errorRate,
        requestCount: call.requestCount
      });
    });

    return revAdj;
  }

  calculateInDegree() {
    const inDeg = {};
    this.serviceNames.forEach(name => {
      inDeg[name] = 0;
    });

    this.data.calls.forEach(call => {
      inDeg[call.to] = (inDeg[call.to] || 0) + 1;
    });

    return inDeg;
  }

  calculateOutDegree() {
    const outDeg = {};
    this.serviceNames.forEach(name => {
      outDeg[name] = 0;
    });

    this.data.calls.forEach(call => {
      outDeg[call.from] = (outDeg[call.from] || 0) + 1;
    });

    return outDeg;
  }

  topologicalSort() {
    const inDeg = { ...this.calculateInDegree() };
    const queue = [];
    const result = [];

    Object.entries(inDeg).forEach(([name, deg]) => {
      if (deg === 0) {
        queue.push(name);
      }
    });

    while (queue.length > 0) {
      const current = queue.shift();
      result.push(current);

      const neighbors = this.buildAdjacencyList()[current] || [];
      neighbors.forEach(neighbor => {
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

  assignLayers() {
    const layers = {};
    const adj = this.buildAdjacencyList();
    const inDeg = this.calculateInDegree();
    const maxDepth = this.serviceNames.length + 10;

    const roots = Object.entries(inDeg)
      .filter(([_, deg]) => deg === 0)
      .map(([name]) => name);

    const assignLayer = (service, layer, path = new Set()) => {
      if (layer > maxDepth) return;
      if (path.has(service)) return;
      
      path.add(service);
      
      if (layers[service] === undefined || layers[service] < layer) {
        layers[service] = layer;
      }

      adj[service].forEach(neighbor => {
        if (!path.has(neighbor.service)) {
          assignLayer(neighbor.service, layer + 1, new Set(path));
        }
      });
    };

    roots.forEach(root => assignLayer(root, 0));

    this.serviceNames.forEach(name => {
      if (layers[name] === undefined) {
        assignLayer(name, 0);
      }
    });

    const allLayers = Object.values(layers);
    const maxLayer = allLayers.length > 0 ? Math.max(...allLayers) : 0;
    const grouped = {};
    for (let i = 0; i <= maxLayer; i++) {
      grouped[i] = [];
    }
    Object.entries(layers).forEach(([name, layer]) => {
      grouped[layer].push(name);
    });

    return { layers, grouped, maxLayer };
  }

  detectCycles() {
    const adj = this.buildAdjacencyList();
    const visited = new Set();
    const recursionStack = new Set();
    const cycles = [];
    const path = [];

    const dfs = (service) => {
      visited.add(service);
      recursionStack.add(service);
      path.push(service);

      const neighbors = adj[service] || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor.service)) {
          if (dfs(neighbor.service)) {
            return true;
          }
        } else if (recursionStack.has(neighbor.service)) {
          const cycleStart = path.indexOf(neighbor.service);
          const cycle = path.slice(cycleStart);
          cycle.push(neighbor.service);
          cycles.push([...cycle]);
          return true;
        }
      }

      recursionStack.delete(service);
      path.pop();
      return false;
    };

    this.serviceNames.forEach(name => {
      if (!visited.has(name)) {
        dfs(name);
      }
    });

    return cycles;
  }

  findAllPaths(start, end, maxDepth = 10) {
    const adj = this.buildAdjacencyList();
    const paths = [];
    const visited = new Set();

    const dfs = (current, path, depth) => {
      if (depth > maxDepth) return;
      if (current === end) {
        paths.push([...path]);
        return;
      }

      visited.add(current);
      const neighbors = adj[current] || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor.service)) {
          path.push(neighbor.service);
          dfs(neighbor.service, path, depth + 1);
          path.pop();
        }
      }
      visited.delete(current);
    };

    dfs(start, [start], 0);
    return paths;
  }

  getDownstreamServices(serviceName) {
    const adj = this.buildAdjacencyList();
    const visited = new Set();
    const result = [];

    const dfs = (current) => {
      if (visited.has(current)) return;
      visited.add(current);
      
      const neighbors = adj[current] || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor.service)) {
          result.push(neighbor.service);
          dfs(neighbor.service);
        }
      }
    };

    dfs(serviceName);
    return result;
  }

  getUpstreamServices(serviceName) {
    const revAdj = this.buildReverseAdjacencyList();
    const visited = new Set();
    const result = [];

    const dfs = (current) => {
      if (visited.has(current)) return;
      visited.add(current);
      
      const neighbors = revAdj[current] || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor.service)) {
          result.push(neighbor.service);
          dfs(neighbor.service);
        }
      }
    };

    dfs(serviceName);
    return result;
  }
}

module.exports = DependencyAnalyzer;
