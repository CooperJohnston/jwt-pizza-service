const config = require('./config');

class MetricBuilder {

  constructor() {
    this.metrics = [];
    // record one process start time for cumulative sums
    this.processStartUnixNano = String(Date.now() * 1_000_000);
  }

  add(metricName, metricValue, metricUnit, metricType, valueType, attributes = {}) {
    const metric = this.createMetric(metricName, metricValue, metricUnit, metricType, valueType, attributes);
    this.metrics.push(metric);
  }

  sendMetricToGrafana(metrics) {
    const body = {
      resourceMetrics: [
        {
          // add minimal resource + scope metadata
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: config.source || 'pizza-web' } },
            ],
          },
          scopeMetrics: [
            {
              scope: { name: 'custom-metrics', version: '1.0.0' },
              metrics,
            },
          ],
        },
      ],
    };

    fetch(`${config.url}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP status: ${response.status}`);
        }
        // clear metrics after successful send
        this.metrics = [];
      })
      .catch((error) => {
        console.error('Error pushing metrics:', error);
      });
  }

  createMetric(metricName, metricValue, metricUnit, metricType, valueType, attributes) {
    attributes = { ...attributes, source: config.source };

    const dataPoint = {
      [valueType]: metricValue,
      // send timestamps as strings to avoid JS overflow
      timeUnixNano: String(Date.now() * 1_000_000),
      attributes: [],
    };

    // for cumulative sums, add startTimeUnixNano
    if (metricType === 'sum') {
      dataPoint.startTimeUnixNano = this.processStartUnixNano;
    }

    const metric = {
      name: metricName,
      unit: metricUnit,
      [metricType]: {
        dataPoints: [dataPoint],
      },
    };

    // add attributes
    for (const key of Object.keys(attributes)) {
      metric[metricType].dataPoints[0].attributes.push({
        key,
        value: { stringValue: String(attributes[key]) },
      });
    }

    // fix aggregationTemporality to numeric enum (2 = cumulative)
    if (metricType === 'sum') {
      metric[metricType].aggregationTemporality = 2;
      metric[metricType].isMonotonic = true;
    }

    return metric;
  }
}

module.exports = MetricBuilder;
