const express = require('express');
const router = express.Router();
const ussdController = require('../controllers/ussd.controller');

// USSD endpoint (production)
router.post('/ussd', ussdController.handleRequest.bind(ussdController));

// USSD test endpoint (for Postman testing)
router.post('/ussd-test', async (req, res) => {
  const { msisdn, sessionid, shortcode, response } = req.body;
  
  try {
    // Validate required parameters
    if (!msisdn || !sessionid) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: msisdn and sessionid are required'
      });
    }

    // Process the request through your controller
    const result = await ussdController.processUssdRequest(msisdn, sessionid, shortcode, response);
    
    // Return clean JSON for testing
    res.json({
      success: true,
      action: result.action,
      message: result.message,
      nextMenu: result.nextMenu,
      name: result.name,
      // Also include the USSD format if needed
      ussdFormat: `${result.action} ${result.message}`
    });
  } catch (error) {
    console.error('USSD test error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Alternative: Query parameter version
router.post('/ussd-json', async (req, res) => {
  const { msisdn, sessionid, shortcode, response } = req.body;
  
  try {
    const result = await ussdController.processUssdRequest(msisdn, sessionid, shortcode, response);
    
    // Always return JSON
    res.json({
      action: result.action,
      message: result.message,
      nextMenu: result.nextMenu,
      name: result.name
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

module.exports = router;