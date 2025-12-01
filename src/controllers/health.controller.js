const { loggingService } = require('../services/logging.service');
const sessionService = require('../services/session.service');

class HealthController {
    async check(req, res) {
        try {
            const sessionHealth = await sessionService.healthCheck();
            
            const healthStatus = {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                services: {
                    redis: sessionHealth.redis,
                    session: sessionHealth.healthy ? 'healthy' : 'unhealthy'
                }
            };
            
            const overallHealthy = sessionHealth.healthy;
            
            res.status(overallHealthy ? 200 : 503).json(healthStatus);
        } catch (error) {
            loggingService.error('Health check failed', { error: error.message });
            res.status(503).json({
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                error: error.message
            });
        }
    }

    async metrics(req, res) {
        // Add your metrics logic here
        res.json({
            status: 'ok',
            metrics: {
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                timestamp: new Date().toISOString()
            }
        });
    }
}

module.exports = new HealthController();