// Paul's Pantry Backend API
// Run with: node server.js

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const sgMail = require('@sendgrid/mail');
const cron = require('node-cron');
const { parse } = require('node-html-parser');

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
const db = new sqlite3.Database('./pantry.db');

// Initialize database
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      last_purchased DATE,
      estimated_duration_days INTEGER,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS email_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      email_content TEXT,
      recipients TEXT,
      type TEXT
    )
  `);

  // Insert sample data if table is empty
  db.get("SELECT COUNT(*) as count FROM items", (err, row) => {
    if (row.count === 0) {
      const sampleItems = [
        ['Dog food', 'Pet', '2025-06-15', 90],
        ['Toilet roll', 'House', '2025-07-01', 30],
        ['Nappies', 'Baby', '2025-07-10', 14],
        ['Washing powder', 'House', '2025-06-20', 45]
      ];

      const stmt = db.prepare(`
        INSERT INTO items (name, category, last_purchased, estimated_duration_days)
        VALUES (?, ?, ?, ?)
      `);

      sampleItems.forEach(item => {
        stmt.run(item);
      });
      stmt.finalize();
      
      console.log('✅ Sample data inserted');
    }
  });
});

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

// Get all items
app.get('/api/items', (req, res) => {
  db.all("SELECT * FROM items WHERE status = 'active' ORDER BY category, name", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Add new item
app.post('/api/items', (req, res) => {
  const { name, category, lastPurchased, estimatedDurationDays } = req.body;
  
  db.run(`
    INSERT INTO items (name, category, last_purchased, estimated_duration_days)
    VALUES (?, ?, ?, ?)
  `, [name, category, lastPurchased, estimatedDurationDays], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    db.get("SELECT * FROM items WHERE id = ?", [this.lastID], (err, row) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(row);
    });
  });
});

// Update item
app.put('/api/items/:id', (req, res) => {
  const { name, category, lastPurchased, estimatedDurationDays } = req.body;
  const { id } = req.params;
  
  db.run(`
    UPDATE items 
    SET name = ?, category = ?, last_purchased = ?, estimated_duration_days = ?
    WHERE id = ?
  `, [name, category, lastPurchased, estimatedDurationDays, id], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    db.get("SELECT * FROM items WHERE id = ?", [id], (err, row) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(row);
    });
  });
});

// Delete item
app.delete('/api/items/:id', (req, res) => {
  const { id } = req.params;
  
  db.run("UPDATE items SET status = 'deleted' WHERE id = ?", [id], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ message: 'Item deleted successfully' });
  });
});

// Send reminder email manually
app.post('/api/send-reminder', async (req, res) => {
  try {
    db.all("SELECT * FROM items WHERE status = 'active'", async (err, items) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      
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
      db.run(`
        INSERT INTO email_logs (email_content, recipients, type)
        VALUES (?, ?, ?)
      `, [emailContent, TO_EMAILS.join(', '), 'manual']);
      
      res.json({ 
        message: 'Reminder email sent successfully!',
        itemsCount: lowItems.length,
        recipients: TO_EMAILS
      });
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
    // Get current items for context
    db.all("SELECT * FROM items WHERE status = 'active'", async (err, items) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      
      // Call Claude API to parse the response
      const prompt = `
        You are helping to parse a natural language response about household items. 
        
        Current items being tracked: ${items.map(item => item.name).join(', ')}
        
        User's response: "${response}"
        
        Please parse this response and extract updates for any mentioned items. Return ONLY a valid JSON object with this structure:
        {
          "updates": [
            {
              "itemName": "exact item name",
              "status": "ordered|plenty|running_low|nearly_out|out_of", 
              "daysUntilNeeded": number,
              "newDurationDays": number
            }
          ],
          "newItems": [
            {
              "itemName": "new item name",
              "category": "House|Baby|Pet",
              "durationDays": number,
              "status": "out_of|running_low|plenty"
            }
          ],
          "removeItems": [
            {
              "itemName": "item to remove"
            }
          ]
        }
        
        Rules:
        - Convert time phrases: "2 weeks" = 14, "month" = 30, "tomorrow" = 1, "plenty" = 30
        - If user mentions new frequency (like "every month"), set newDurationDays
        - If user says when they need it (like "within 2 weeks"), set daysUntilNeeded
        - For new items mentioned (like "we're out of fairy liquid"), add to newItems
        - Guess appropriate category for new items (House for cleaning supplies, Baby for baby items, Pet for pet supplies)
        - If user says "don't need X anymore" or "remove X", add to removeItems
        - For items mentioned with just frequency (like "fairy liquid, every 4 weeks"), treat as new items
        - DO NOT include markdown formatting or code blocks
        - Return ONLY the JSON object, nothing else
      `;
      
      // Here you'd call your Claude API
      // For now, I'll create a mock response parser
      const mockClaudeResponse = await mockParseResponse(response, items);
      
      let updatesApplied = [];
      const today = new Date().toISOString().split('T')[0];
      
      // Process updates
      if (mockClaudeResponse.updates) {
        for (const update of mockClaudeResponse.updates) {
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
              // Calculate backwards from target date
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
            
            // Update in database
            db.run(`
              UPDATE items 
              SET last_purchased = ?, estimated_duration_days = ?
              WHERE id = ?
            `, [newLastPurchased, newDuration, item.id]);
          }
        }
      }
      
      // Add new items
      if (mockClaudeResponse.newItems) {
        for (const newItem of mockClaudeResponse.newItems) {
          let lastPurchased = today;
          
          if (newItem.status === 'out_of') {
            const pastDate = new Date();
            pastDate.setDate(pastDate.getDate() - (newItem.durationDays || 30) - 1);
            lastPurchased = pastDate.toISOString().split('T')[0];
          }
          
          db.run(`
            INSERT INTO items (name, category, last_purchased, estimated_duration_days)
            VALUES (?, ?, ?, ?)
          `, [newItem.itemName, newItem.category || 'House', lastPurchased, newItem.durationDays || 30]);
          
          updatesApplied.push(`Added: ${newItem.itemName}`);
        }
      }
      
      // Remove items
      if (mockClaudeResponse.removeItems) {
        for (const removeItem of mockClaudeResponse.removeItems) {
          const item = items.find(i => 
            i.name.toLowerCase().includes(removeItem.itemName.toLowerCase())
          );
          
          if (item) {
            db.run("UPDATE items SET status = 'deleted' WHERE id = ?", [item.id]);
            updatesApplied.push(`Removed: ${item.name}`);
          }
        }
      }
      
      res.json({
        message: 'Response processed successfully',
        updatesApplied: updatesApplied
      });
    });
  } catch (error) {
    console.error('Error processing response:', error);
    res.status(500).json({ error: 'Failed to process response' });
  }
});

// Mock Claude response parser (replace with real Claude API call)
async function mockParseResponse(response, items) {
  // Simple mock parser - replace this with actual Claude API call
  const updates = [];
  const newItems = [];
  
  if (response.toLowerCase().includes('ordered')) {
    const words = response.split(' ');
    for (let i = 0; i < words.length; i++) {
      if (words[i].toLowerCase().includes('ordered')) {
        // Look backwards for item name
        for (let j = i - 1; j >= 0; j--) {
          const potentialItem = items.find(item => 
            item.name.toLowerCase().includes(words[j].toLowerCase())
          );
          if (potentialItem) {
            updates.push({
              itemName: potentialItem.name,
              status: 'ordered'
            });
            break;
          }
        }
      }
    }
  }
  
  return { updates, newItems, removeItems: [] };
}

// Webhook for email replies (SendGrid Inbound Parse)
app.post('/webhook/email-reply', (req, res) => {
  try {
    const email = req.body;
    
    // Extract text content from email
    const emailText = email.text || email.html;
    
    console.log('📧 Received email reply:', emailText);
    
    // Process the email content as a natural language response
    // This would call the same logic as /api/process-response
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing email webhook:', error);
    res.status(500).send('Error');
  }
});

// Daily reminder cron job (9 AM every day)
cron.schedule('0 9 * * *', async () => {
  console.log('🕘 Running daily reminder check...');
  
  try {
    db.all("SELECT * FROM items WHERE status = 'active'", async (err, items) => {
      if (err) {
        console.error('Error fetching items:', err);
        return;
      }
      
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
        db.run(`
          INSERT INTO email_logs (email_content, recipients, type)
          VALUES (?, ?, ?)
        `, [emailContent, TO_EMAILS.join(', '), 'automatic']);
        
        console.log(`✅ Daily reminder sent for ${lowItems.length} items`);
      } else {
        console.log('✅ No items need attention today');
      }
    });
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