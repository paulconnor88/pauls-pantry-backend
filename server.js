// Paul's Pantry Backend API
// Run with: node server.js

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const sgMail = require('@sendgrid/mail');
const cron = require('node-cron');
const { parse } = require('node-html-parser');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.raw({ type: 'text/plain' }));

// Email configuration
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const FROM_EMAIL = 'paulconnor88@gmail.com';
const TO_EMAILS = ['paulconnor88@gmail.com', 'debsrinkoff@gmail.com'];

// Claude API configuration
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Database setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/pantry'
});

// Initialize database
const initializeDatabase = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS items (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        last_purchased DATE,
        estimated_duration_days INTEGER,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_logs (
        id SERIAL PRIMARY KEY,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        email_content TEXT,
        recipients TEXT,
        type TEXT
      )
    `);

    // Check if we need sample data
    const result = await pool.query("SELECT COUNT(*) as count FROM items");
    if (result.rows[0].count == 0) {
      const sampleItems = [
        ['Dog food', 'Pet', '2025-06-15', 90],
        ['Toilet roll', 'House', '2025-07-01', 30],
        ['Nappies', 'Baby', '2025-07-10', 14],
        ['Washing powder', 'House', '2025-06-20', 45]
      ];

      for (const item of sampleItems) {
        await pool.query(
          'INSERT INTO items (name, category, last_purchased, estimated_duration_days) VALUES ($1, $2, $3, $4)',
          item
        );
      }
      console.log('✅ Sample data inserted');
    }
  } catch (error) {
    console.error('Database initialization error:', error);
  }
};

initializeDatabase();

// Helper functions
const getItemsRunningLow = (items) => {
  const today = new Date();
  return items.filter(item => {
    const lastPurchased = new Date(item.last_purchased);
    const nextPurchaseDate = new Date(lastPurchased);
    nextPurchaseDate.setDate(lastPurchased.getDate() + item.estimated_duration_days);
    
    const daysUntilNeeded = Math.ceil((nextPurchaseDate - today) / (1000 * 60 * 60 * 24));
    return daysUntilNeeded <= 7 && daysUntilNeeded >= 0;
  });
};

const generateReminderEmail = (lowItems) => {
  if (lowItems.length === 0) return null;
  
  const groupedItems = lowItems.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});
  
  let emailContent = "Paul's Pantry Check-in\n\n";
  emailContent += "Think you might be running low on:\n\n";
  
  Object.entries(groupedItems).forEach(([category, categoryItems]) => {
    const icon = category === 'House' ? '🏠' : category === 'Baby' ? '👶' : '🐕';
    emailContent += `${icon} ${category}: ${categoryItems.map(item => item.name).join(', ')}\n`;
  });
  
  emailContent += "\nJust reply to this email with how things look!\n";
  emailContent += "Example: 'Dog food good for 2 weeks, washing powder nearly out, toilet roll ordered for tomorrow'\n\n";
  emailContent += "—Paul's Pantry 🏠";
  
  return emailContent;
};

// API Routes

app.get('/api/items', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM items WHERE status = 'active' ORDER BY category, name");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/items', async (req, res) => {
  const { name, category, lastPurchased, estimatedDurationDays } = req.body;
  
  try {
    const result = await pool.query(
      'INSERT INTO items (name, category, last_purchased, estimated_duration_days) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, category, lastPurchased, estimatedDurationDays]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update item
app.put('/api/items/:id', async (req, res) => {
  const { name, category, lastPurchased, estimatedDurationDays } = req.body;
  const { id } = req.params;
  
  try {
    const result = await pool.query(
      'UPDATE items SET name = $1, category = $2, last_purchased = $3, estimated_duration_days = $4 WHERE id = $5 RETURNING *',
      [name, category, lastPurchased, estimatedDurationDays, id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete item
app.delete('/api/items/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    await pool.query("UPDATE items SET status = 'deleted' WHERE id = $1", [id]);
    res.json({ message: 'Item deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint to test Claude API directly
app.post('/api/debug-claude', async (req, res) => {
  const { response } = req.body;
  
  let debugInfo = {
    timestamp: new Date().toISOString(),
    input: response,
    apiKeyExists: !!process.env.ANTHROPIC_API_KEY,
    apiKeyLength: process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_API_KEY.length : 0,
    error: null,
    claudeRawResponse: null,
    claudeParsedResponse: null,
    step: 'starting'
  };
  
  try {
    debugInfo.step = 'checking-api-key';
    
    if (!process.env.ANTHROPIC_API_KEY) {
      debugInfo.error = 'ANTHROPIC_API_KEY not found in environment variables';
      debugInfo.availableEnvVars = Object.keys(process.env).filter(key => key.includes('ANTHROPIC'));
      return res.json(debugInfo);
    }
    
    debugInfo.step = 'fetching-items';
    const result = await pool.query("SELECT * FROM items WHERE status = 'active'");
    const items = result.rows;
    debugInfo.itemsCount = items.length;
    
    debugInfo.step = 'creating-prompt';
    const prompt = `You are a household inventory assistant. Parse this natural language response about household items and return structured JSON.

Current items in inventory:
${items.map(item => `- ${item.name} (${item.category}, lasts ${item.estimated_duration_days} days)`).join('\n')}

User response: "${response}"

Return ONLY valid JSON in this format:
{
  "updates": [{"itemName": "Dog food", "daysUntilNeeded": 14}],
  "newItems": [{"itemName": "fairy liquid", "category": "House", "durationDays": 30}],
  "removeItems": []
}`;

    debugInfo.step = 'calling-claude';
    debugInfo.promptLength = prompt.length;
    
    const claudeResponse = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }]
    });
    
    debugInfo.step = 'processing-claude-response';
    debugInfo.claudeRawResponse = claudeResponse.content[0].text;
    
    // Try to parse JSON
    let cleanedText = debugInfo.claudeRawResponse.trim();
    if (cleanedText.startsWith('```json')) {
      cleanedText = cleanedText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    }
    if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    
    debugInfo.claudeCleanedResponse = cleanedText;
    
    try {
      debugInfo.claudeParsedResponse = JSON.parse(cleanedText);
      debugInfo.step = 'success';
    } catch (parseError) {
      debugInfo.error = `JSON parse error: ${parseError.message}`;
      debugInfo.step = 'json-parse-failed';
    }
    
  } catch (error) {
    debugInfo.error = error.message;
    debugInfo.errorStack = error.stack;
    debugInfo.step = 'claude-api-error';
  }
  
  res.json(debugInfo);
});

// Send reminder email manually
app.post('/api/send-reminder', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM items WHERE status = 'active'");
    const items = result.rows;
    
    const lowItems = getItemsRunningLow(items);
    const emailContent = generateReminderEmail(lowItems);
    
    if (!emailContent) {
      res.json({ message: 'No items need attention - no email sent' });
      return;
    }
    
    const msg = {
      to: TO_EMAILS,
      from: FROM_EMAIL,
      subject: `Paul's Pantry Check-in - ${lowItems.length} item${lowItems.length > 1 ? 's' : ''} running low`,
      text: emailContent
    };
    
    await sgMail.send(msg);
    
    // Log the email
    await pool.query(
      'INSERT INTO email_logs (email_content, recipients, type) VALUES ($1, $2, $3)',
      [emailContent, TO_EMAILS.join(', '), 'manual']
    );
    
    res.json({ 
      message: 'Reminder email sent successfully!',
      itemsCount: lowItems.length,
      recipients: TO_EMAILS
    });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// Process natural language response
app.post('/api/process-response', async (req, res) => {
  const { response } = req.body;
  
  try {
    const result = await pool.query("SELECT * FROM items WHERE status = 'active'");
    const items = result.rows;
    
    const claudeResponse = await processWithClaude(response, items);
    
    let updatesApplied = [];
    const today = new Date().toISOString().split('T')[0];
    
    // Process updates
    if (claudeResponse.updates && claudeResponse.updates.length > 0) {
      for (const update of claudeResponse.updates) {
        const item = items.find(i => 
          i.name.toLowerCase().includes(update.itemName.toLowerCase()) ||
          update.itemName.toLowerCase().includes(i.name.toLowerCase())
        );
        
        if (item) {
          let newLastPurchased = item.last_purchased;
          let newDuration = item.estimated_duration_days;
          
          if (update.status === 'ordered') {
            newLastPurchased = today;
            updatesApplied.push(`${item.name}: marked as ordered, reset cycle`);
          } else if (update.daysUntilNeeded) {
            const targetDate = new Date();
            targetDate.setDate(targetDate.getDate() + update.daysUntilNeeded);
            const calculatedDate = new Date(targetDate);
            calculatedDate.setDate(calculatedDate.getDate() - (update.newDurationDays || item.estimated_duration_days));
            newLastPurchased = calculatedDate.toISOString().split('T')[0];
            updatesApplied.push(`${item.name}: updated timeline`);
          }
          
          if (update.newDurationDays) {
            newDuration = update.newDurationDays;
            updatesApplied.push(`${item.name}: frequency changed to ${newDuration} days`);
          }
          
          await pool.query(
            'UPDATE items SET last_purchased = $1, estimated_duration_days = $2 WHERE id = $3',
            [newLastPurchased, newDuration, item.id]
          );
        }
      }
    }
    
    // Add new items
    if (claudeResponse.newItems && claudeResponse.newItems.length > 0) {
      for (const newItem of claudeResponse.newItems) {
        let lastPurchased = today;
        
        if (newItem.status === 'out_of') {
          const pastDate = new Date();
          pastDate.setDate(pastDate.getDate() - (newItem.durationDays || 30) - 1);
          lastPurchased = pastDate.toISOString().split('T')[0];
        }
        
        await pool.query(
          'INSERT INTO items (name, category, last_purchased, estimated_duration_days) VALUES ($1, $2, $3, $4)',
          [newItem.itemName, newItem.category || 'House', lastPurchased, newItem.durationDays || 30]
        );
        
        updatesApplied.push(`Added: ${newItem.itemName}`);
      }
    }
    
    // Remove items
    if (claudeResponse.removeItems && claudeResponse.removeItems.length > 0) {
      for (const removeItem of claudeResponse.removeItems) {
        const item = items.find(i => 
          i.name.toLowerCase().includes(removeItem.itemName.toLowerCase())
        );
        
        if (item) {
          await pool.query("UPDATE items SET status = 'deleted' WHERE id = $1", [item.id]);
          updatesApplied.push(`Removed: ${item.name}`);
        }
      }
    }
    
    res.json({
      message: 'Response processed successfully',
      updatesApplied: updatesApplied
    });
  } catch (error) {
    console.error('Error processing response:', error);
    res.status(500).json({ error: 'Failed to process response' });
  }
});

// Claude API response parser
async function processWithClaude(response, items) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      updates: [],
      newItems: [],
      removeItems: []
    };
  }
  
  try {
    const prompt = `You are a household inventory assistant. Parse this natural language response about household items and return structured JSON.

Current items in inventory:
${items.map(item => `- ${item.name} (${item.category}, lasts ${item.estimated_duration_days} days)`).join('\n')}

User response: "${response}"

Return ONLY valid JSON in this format:
{
  "updates": [{"itemName": "Dog food", "daysUntilNeeded": 14}],
  "newItems": [{"itemName": "fairy liquid", "category": "House", "durationDays": 30}],
  "removeItems": []
}`;

    const claudeResponse = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }]
    });
    
    const claudeText = claudeResponse.content[0].text;
    
    // Clean the response
    let cleanedText = claudeText.trim();
    if (cleanedText.startsWith('```json')) {
      cleanedText = cleanedText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    }
    if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    
    try {
      return JSON.parse(cleanedText);
    } catch (parseError) {
      return {
        updates: [],
        newItems: [],
        removeItems: []
      };
    }

  } catch (error) {
    return {
      updates: [],
      newItems: [],
      removeItems: []
    };
  }
}

// Webhook for email replies (SendGrid Inbound Parse)
app.post('/webhook/email-reply', (req, res) => {
  try {
    const email = req.body;
    const emailText = email.text || email.html;
    console.log('📧 Received email reply:', emailText);
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing email webhook:', error);
    res.status(500).send('Error');
  }
});

// Daily work schedule
cron.schedule('0 9 * * *', async () => {
  console.log('🕘 Running daily reminder check...');
  
  try {
    const result = await pool.query("SELECT * FROM items WHERE status = 'active'");
    const items = result.rows;
    
    const lowItems = getItemsRunningLow(items);
    
    if (lowItems.length > 0) {
      const emailContent = generateReminderEmail(lowItems);
      
      const msg = {
        to: TO_EMAILS,
        from: FROM_EMAIL,
        subject: `Paul's Pantry Daily Check-in - ${lowItems.length} item${lowItems.length > 1 ? 's' : ''} running low`,
        text: emailContent
      };
      
      await sgMail.send(msg);
      
      // Log the email
      await pool.query(
        'INSERT INTO email_logs (email_content, recipients, type) VALUES ($1, $2, $3)',
        [emailContent, TO_EMAILS.join(', '), 'automatic']
      );
      
      console.log(`✅ Daily reminder sent for ${lowItems.length} items`);
    } else {
      console.log('✅ No items need attention today');
    }
  } catch (error) {
    console.error('Error in daily reminder:', error);
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Paul's Pantry API running on port ${PORT}`);
  console.log(`📧 Email notifications: ${TO_EMAILS.join(', ')}`);
  console.log(`📅 Daily reminders scheduled for 9:00 AM`);
});

module.exports = app;
