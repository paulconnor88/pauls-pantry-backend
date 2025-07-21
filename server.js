// Paul's Pantry Backend API
// Run with: node server.js

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const sgMail = require('@sendgrid/mail');
const cron = require('node-cron');
const { parse } = require('node-html-parser');

// Add Twilio for SMS
const twilioSendSMS = async (phoneNumber, message) => {
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(`${process.env.TWILIO_SID}:${process.env.TWILIO_TOKEN}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      To: phoneNumber,
      From: process.env.TWILIO_PHONE_NUMBER,
      Body: message
    })
  });
  
  if (!response.ok) {
    throw new Error(`SMS failed: ${response.status}`);
  }
  
  return response.json();
};

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

// Database setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/pantry'
});

console.log('🚀 Using Claude HTTP integration - no SDK dependencies needed!');

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
    const icon = category === 'House' ? '🏠' : category === 'Baby' ? '👶' : category === 'Food' ? '🍞' : '🐕';
    emailContent += `${icon} ${category}: ${categoryItems.map(item => item.name).join(', ')}\n`;
  });
  
  emailContent += "\nJust reply to this email with how things look!\n";
  emailContent += "Example: 'Dog food good for 2 weeks, washing powder nearly out, toilet roll ordered for tomorrow'\n\n";
  emailContent += "—Paul's Pantry 🏠";
  
  return emailContent;
};

// SMS version - shorter format for 160 char limit
const generateReminderSMS = (lowItems) => {
  if (lowItems.length === 0) return null;
  
  const itemNames = lowItems.map(item => item.name).join(', ');
  return `Paul's Pantry: Low on ${itemNames}. Reply with status!`;
};

// ULTRA AGGRESSIVE Claude HTTP Integration Function
async function processWithClaude(response, items) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('❌ Anthropic API key not available');
    return { updates: [], newItems: [], removeItems: [] };
  }

  try {
    console.log('🤖 Processing with Claude via HTTP...');
    
    const prompt = `You are a household inventory assistant. You MUST create entries for ANY items mentioned by users.

CURRENT INVENTORY:
${items.map(item => `- ID:${item.id} "${item.name}" (${item.category})`).join('\n')}

USER SAID: "${response}"

CATEGORY RULES:
- Food: bread, milk, eggs, cheese, butter, rice, pasta, cereal, frozen peas, fruit, vegetables
- Baby: nappies, diapers, baby food, formula, baby wipes, dummy, pacifier, baby bottles
- Pet: dog food, cat food, dog treats, dog chews, pet supplies, bird seed
- House: toilet roll, washing powder, cleaning products, bin bags, kitchen roll
- Health: vitamins, medicine, paracetamol, plasters, supplements

PARSING RULES:
1. If user mentions ANY item not in current inventory - CREATE IT in newItems
2. If user mentions an existing item - UPDATE IT in updates array
3. Parse "1 week" = 7 days, "2 weeks" = 14 days, "1 month" = 30 days
4. Parse "today" = ${new Date().toISOString().split('T')[0]}
5. Parse "yesterday" = ${new Date(Date.now() - 86400000).toISOString().split('T')[0]}
6. Parse "bought X days ago" = subtract X days from today

EXAMPLES:
- "bread, 1 week, bought today" = CREATE bread in Food category, 7 days duration, purchased today
- "milk, 1 week" = CREATE milk in Food category, 7 days duration
- "nappies, 2 weeks, bought yesterday" = UPDATE existing nappies (ID:3)
- "dog treats" = CREATE dog treats in Pet category

You MUST return ONLY valid JSON. NO explanations, NO markdown, NO extra text:

{
  "updates": [
    {
      "itemId": 3,
      "itemName": "Nappies",
      "newLastPurchased": "2025-07-20",
      "newDurationDays": 14,
      "reason": "User updated timeline"
    }
  ],
  "newItems": [
    {
      "itemName": "Bread",
      "category": "Food", 
      "lastPurchased": "2025-07-21",
      "durationDays": 7,
      "reason": "User mentioned new item"
    }
  ],
  "removeItems": []
}

BE AGGRESSIVE - CREATE ANY ITEMS THE USER MENTIONS!`;

    console.log('📤 Sending prompt to Claude...');

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!claudeResponse.ok) {
      throw new Error(`Claude API error: ${claudeResponse.status} ${claudeResponse.statusText}`);
    }

    const result = await claudeResponse.json();
    console.log('✅ Claude HTTP response received');
    
    const claudeText = result.content[0].text;
    console.log('🔍 Full Claude response:', claudeText);
    
    // Clean and parse JSON response
    let cleanedText = claudeText.trim();
    if (cleanedText.startsWith('```json')) {
      cleanedText = cleanedText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    }
    if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    
    try {
      const analysis = JSON.parse(cleanedText);
      console.log('✅ Parsed Claude response:', analysis);
      return {
        updates: analysis.updates || [],
        newItems: analysis.newItems || [],
        removeItems: analysis.removeItems || []
      };
    } catch (parseError) {
      console.log('❌ Failed to parse Claude response as JSON:', parseError.message);
      console.log('❌ Raw Claude text:', claudeText);
      return { updates: [], newItems: [], removeItems: [] };
    }

  } catch (error) {
    console.log('❌ Claude HTTP integration error:', error.message);
    return { updates: [], newItems: [], removeItems: [] };
  }
}

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

app.delete('/api/items/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    await pool.query("UPDATE items SET status = 'deleted' WHERE id = $1", [id]);
    res.json({ message: 'Item deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint to test Claude HTTP integration
app.post('/api/debug-claude', async (req, res) => {
  const { userInput } = req.body;
  
  try {
    const result = await pool.query("SELECT * FROM items WHERE status = 'active'");
    const items = result.rows;
    
    const claudeResponse = await processWithClaude(userInput, items);
    
    res.json({
      success: true,
      input: userInput,
      claudeResponse: claudeResponse,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
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

// FIXED Process natural language response endpoint
app.post('/api/process-response', async (req, res) => {
  const { userInput } = req.body;
  
  try {
    const result = await pool.query("SELECT * FROM items WHERE status = 'active'");
    const items = result.rows;
    
    const claudeResponse = await processWithClaude(userInput, items);
    
    let updatesApplied = [];
    const today = new Date().toISOString().split('T')[0];
    
    // Process updates to EXISTING items
    if (claudeResponse.updates && claudeResponse.updates.length > 0) {
      for (const update of claudeResponse.updates) {
        if (update.itemId) {
          // Update by ID (most reliable)
          await pool.query(
            'UPDATE items SET last_purchased = $1, estimated_duration_days = $2 WHERE id = $3',
            [update.newLastPurchased, update.newDurationDays, update.itemId]
          );
          updatesApplied.push(`Updated: ${update.itemName} - ${update.reason}`);
        } else {
          // Fallback: find by name similarity
          const item = items.find(i => 
            i.name.toLowerCase().includes(update.itemName.toLowerCase()) ||
            update.itemName.toLowerCase().includes(i.name.toLowerCase())
          );
          
          if (item) {
            await pool.query(
              'UPDATE items SET last_purchased = $1, estimated_duration_days = $2 WHERE id = $3',
              [update.newLastPurchased, update.newDurationDays, item.id]
            );
            updatesApplied.push(`Updated: ${item.name} - ${update.reason}`);
          }
        }
      }
    }
    
    // Add NEW items
    if (claudeResponse.newItems && claudeResponse.newItems.length > 0) {
      for (const newItem of claudeResponse.newItems) {
        const insertResult = await pool.query(
          'INSERT INTO items (name, category, last_purchased, estimated_duration_days) VALUES ($1, $2, $3, $4) RETURNING *',
          [newItem.itemName, newItem.category, newItem.lastPurchased, newItem.durationDays]
        );
        updatesApplied.push(`Added: ${newItem.itemName} (${newItem.category}) - ${newItem.reason}`);
      }
    }
    
    // Remove items if requested
    if (claudeResponse.removeItems && claudeResponse.removeItems.length > 0) {
      for (const removeItem of claudeResponse.removeItems) {
        await pool.query(
          "UPDATE items SET status = 'deleted' WHERE name ILIKE $1",
          [`%${removeItem.itemName}%`]
        );
        updatesApplied.push(`Removed: ${removeItem.itemName}`);
      }
    }
    
    res.json({
      message: 'Response processed successfully',
      updatesApplied: updatesApplied,
      claudeResponse: claudeResponse // Include for debugging
    });
  } catch (error) {
    console.error('Error processing response:', error);
    res.status(500).json({ 
      error: 'Failed to process response',
      details: error.message 
    });
  }
});

// Webhook for email replies
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

// Webhook for SMS replies  
app.post('/webhook/sms-reply', async (req, res) => {
  try {
    const { Body, From } = req.body; // Twilio webhook format
    console.log('📱 Received SMS reply:', Body, 'from:', From);
    
    // Process SMS using existing Claude logic
    const result = await pool.query("SELECT * FROM items WHERE status = 'active'");
    const items = result.rows;
    
    const claudeResponse = await processWithClaude(Body, items);
    
    // Apply updates (same logic as /api/process-response)
    let updatesApplied = [];
    const today = new Date().toISOString().split('T')[0];
    
    if (claudeResponse.updates && claudeResponse.updates.length > 0) {
      for (const update of claudeResponse.updates) {
        const item = items.find(i => 
          i.name.toLowerCase().includes(update.itemName.toLowerCase()) ||
          update.itemName.toLowerCase().includes(i.name.toLowerCase())
        );
        
        if (item && update.daysUntilNeeded) {
          const targetDate = new Date();
          targetDate.setDate(targetDate.getDate() + update.daysUntilNeeded);
          const calculatedDate = new Date(targetDate);
          calculatedDate.setDate(calculatedDate.getDate() - item.estimated_duration_days);
          const newLastPurchased = calculatedDate.toISOString().split('T')[0];
          
          await pool.query(
            'UPDATE items SET last_purchased = $1 WHERE id = $2',
            [newLastPurchased, item.id]
          );
          
          updatesApplied.push(item.name);
        }
      }
    }
    
    // Send confirmation SMS if updates were made
    if (updatesApplied.length > 0 && process.env.TWILIO_PHONE_NUMBER) {
      const confirmationMsg = `✅ Updated: ${updatesApplied.join(', ')}`;
      await twilioSendSMS(From, confirmationMsg);
    }
    
    res.status(200).send('<Response></Response>'); // TwiML response
  } catch (error) {
    console.error('Error processing SMS webhook:', error);
    res.status(500).send('Error');
  }
});

// Daily reminder schedule
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
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    claudeHTTP: !!process.env.ANTHROPIC_API_KEY,
    apiKey: !!process.env.ANTHROPIC_API_KEY,
    databaseConnection: true
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Paul's Pantry API running on port ${PORT}`);
  console.log(`📧 Email notifications: ${TO_EMAILS.join(', ')}`);
  console.log(`📅 Daily reminders scheduled for 9:00 AM`);
  console.log(`🤖 Claude HTTP: ${process.env.ANTHROPIC_API_KEY ? 'Ready' : 'API key missing'}`);
});

module.exports = app;