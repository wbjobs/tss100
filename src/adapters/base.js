class BaseAdapter {
  constructor(config = {}) {
    this.config = config;
    this.connected = false;
  }

  async connect() {
    throw new Error('connect() must be implemented by subclass');
  }

  async collect(serviceName = null) {
    throw new Error('collect() must be implemented by subclass');
  }

  isConnected() {
    return this.connected;
  }
}

module.exports = BaseAdapter;
