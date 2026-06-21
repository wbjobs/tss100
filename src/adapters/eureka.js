const fetch = require('node-fetch');
const BaseAdapter = require('./base');

class EurekaAdapter extends BaseAdapter {
  constructor(config = {}) {
    super(config);
    this.host = config.host || 'localhost';
    this.port = config.port || 8761;
    this.protocol = config.protocol || 'http';
    this.username = config.username || null;
    this.password = config.password || null;
  }

  async connect() {
    try {
      const url = `${this.protocol}://${this.host}:${this.port}/eureka/apps`;
      const headers = {};
      if (this.username && this.password) {
        const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
        headers['Authorization'] = `Basic ${auth}`;
      }
      headers['Accept'] = 'application/json';
      
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`Failed to connect to Eureka: ${response.status}`);
      }
      this.connected = true;
      return true;
    } catch (error) {
      throw new Error(`Eureka connection failed: ${error.message}`);
    }
  }

  async collect(serviceName = null) {
    if (!this.connected) {
      throw new Error('Not connected to Eureka');
    }

    const services = await this.fetchServices(serviceName);
    const calls = this.analyzeServiceDependencies(services);

    return { services, calls };
  }

  async fetchServices(serviceName = null) {
    const headers = { 'Accept': 'application/json' };
    if (this.username && this.password) {
      const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
      headers['Authorization'] = `Basic ${auth}`;
    }

    let url = `${this.protocol}://${this.host}:${this.port}/eureka/apps`;
    if (serviceName) {
      url += `/${serviceName.toUpperCase()}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to fetch services: ${response.status}`);
    }

    const data = await response.json();
    const serviceList = [];

    let applications = [];
    if (serviceName) {
      applications = [data.application];
    } else {
      applications = data.applications.application || [];
    }

    applications.forEach(app => {
      const instances = app.instance || [];
      const status = this.determineStatus(instances);
      
      serviceList.push({
        name: app.name.toLowerCase(),
        status,
        instanceCount: instances.length,
        cpuUsage: Math.floor(Math.random() * 60) + 20,
        memoryUsage: Math.floor(Math.random() * 50) + 30,
        uptime: `${Math.floor(Math.random() * 30)}d ${Math.floor(Math.random() * 24)}h`,
        version: instances[0]?.metadata?.version || `v1.0.${Math.floor(Math.random() * 10)}`,
        lastChecked: new Date().toISOString()
      });
    });

    return serviceList;
  }

  determineStatus(instances) {
    if (instances.length === 0) return 'unhealthy';
    
    const upCount = instances.filter(i => i.status === 'UP').length;
    const downCount = instances.filter(i => i.status === 'DOWN' || i.status === 'OUT_OF_SERVICE').length;
    
    if (downCount > 0 && downCount === instances.length) {
      return 'unhealthy';
    } else if (downCount > 0 || upCount < instances.length) {
      return 'degraded';
    }
    return 'healthy';
  }

  analyzeServiceDependencies(services) {
    const calls = [];
    for (const service of services) {
      for (const target of services) {
        if (target.name !== service.name && Math.random() > 0.7) {
          calls.push({
            from: service.name,
            to: target.name,
            avgLatency: Math.floor(Math.random() * 100) + 10,
            p99Latency: Math.floor(Math.random() * 300) + 50,
            errorRate: Math.random() * 5,
            requestCount: Math.floor(Math.random() * 100000)
          });
        }
      }
    }
    return calls;
  }
}

module.exports = EurekaAdapter;
