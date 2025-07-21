import React, { useState, useEffect } from 'react';

// Using simple text icons instead of lucide-react
const Plus = ({ size }) => <span style={{ fontSize: size ? `${size}px` : '16px' }}>+</span>;
const Edit2 = ({ size }) => <span style={{ fontSize: size ? `${size}px` : '16px' }}>✏️</span>;
const Trash2 = ({ size }) => <span style={{ fontSize: size ? `${size}px` : '16px' }}>🗑️</span>;
const Mail = ({ size }) => <span style={{ fontSize: size ? `${size}px` : '16px' }}>📧</span>;
const Clock = ({ size }) => <span style={{ fontSize: size ? `${size}px` : '16px' }}>⏰</span>;
const ShoppingCart = ({ size }) => <span style={{ fontSize: size ? `${size}px` : '16px' }}>🛒</span>;
const Package = ({ size }) => <span style={{ fontSize: size ? `${size}px` : '16px' }}>📦</span>;

const API_BASE_URL = 'https://pauls-pantry-backend-production.up.railway.app/api';

const PaulsPantry = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [activeTab, setActiveTab] = useState('items');
  const [filterMode, setFilterMode] = useState('all');
  const [emailResponse, setEmailResponse] = useState('');
  const [processingResponse, setProcessingResponse] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);

  const [newItem, setNewItem] = useState({
    name: '',
    category: 'House',
    lastPurchased: new Date().toISOString().split('T')[0],
    estimatedDurationDays: 30
  });

  const categories = ['House', 'Baby', 'Pet', 'Food', 'Car'];
  
  const frequencyOptions = [
    { label: 'Weekly', days: 7 },
    { label: 'Fortnightly', days: 14 },
    { label: 'Monthly', days: 30 },
    { label: '6 weeks', days: 42 },
    { label: '2 months', days: 60 },
    { label: '3 months', days: 90 },
    { label: '6 months', days: 180 },
    { label: 'Yearly', days: 365 }
  ];

  // Load items from API on component mount
  useEffect(() => {
    fetchItems();
  }, []);
  
  const fetchItems = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/items`);
      if (response.ok) {
        const data = await response.json();
        setItems(data);
      } else {
        console.error('Failed to fetch items');
      }
    } catch (error) {
      console.error('Error fetching items:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const getFrequencyLabel = (days) => {
    const frequency = frequencyOptions.find(f => f.days === days);
    if (frequency) return frequency.label;
    
    if (days <= 10) return `${days} days`;
    if (days < 30) return `${Math.round(days / 7)} weeks`;
    if (days < 90) return `${Math.round(days / 30)} months`;
    return `${Math.round(days / 30)} months`;
  };

  // Check for items running low (upcoming purchases - within 7 days)
  const getItemsRunningLow = () => {
    const today = new Date();
    return items.filter(item => {
      const lastPurchased = new Date(item.last_purchased);
      const nextPurchaseDate = new Date(lastPurchased);
      nextPurchaseDate.setDate(lastPurchased.getDate() + item.estimated_duration_days);
      
      const daysUntilNeeded = Math.ceil((nextPurchaseDate - today) / (1000 * 60 * 60 * 24));
      return daysUntilNeeded <= 7 && daysUntilNeeded >= 0;
    });
  };

  // Check for recently purchased items (within last 7 days)
  const getRecentlyPurchased = () => {
    const today = new Date();
    return items.filter(item => {
      const lastPurchased = new Date(item.last_purchased);
      const daysSincePurchase = Math.ceil((today - lastPurchased) / (1000 * 60 * 60 * 24));
      return daysSincePurchase <= 7 && daysSincePurchase >= 0;
    });
  };

  const upcomingItems = getItemsRunningLow();
  const recentItems = getRecentlyPurchased();

  const handleAddItem = async () => {
    if (newItem.name.trim()) {
      try {
        console.log('Adding item:', newItem);
        
        const response = await fetch(`${API_BASE_URL}/items`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: newItem.name,
            category: newItem.category,
            lastPurchased: newItem.lastPurchased,
            estimatedDurationDays: newItem.estimatedDurationDays
          }),
        });
        
        console.log('Response status:', response.status);
        
        if (response.ok) {
          console.log('Item added successfully');
          await fetchItems();
          setNewItem({
            name: '',
            category: 'House',
            lastPurchased: new Date().toISOString().split('T')[0],
            estimatedDurationDays: 30
          });
          setShowAddForm(false);
        } else {
          const errorText = await response.text();
          console.error('Failed to add item:', errorText);
          alert(`Failed to add item: ${errorText}`);
        }
      } catch (error) {
        console.error('Error adding item:', error);
        alert(`Error adding item: ${error.message}`);
      }
    } else {
      alert('Please enter an item name');
    }
  };

  const handleEditItem = (item) => {
    setEditingItem(item);
    setNewItem({
      name: item.name,
      category: item.category,
      lastPurchased: item.last_purchased,
      estimatedDurationDays: item.estimated_duration_days
    });
  };

  const handleUpdateItem = async () => {
    if (editingItem && newItem.name.trim()) {
      try {
        const response = await fetch(`${API_BASE_URL}/items/${editingItem.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: newItem.name,
            category: newItem.category,
            lastPurchased: newItem.lastPurchased,
            estimatedDurationDays: newItem.estimatedDurationDays
          }),
        });
        
        if (response.ok) {
          await fetchItems();
          setEditingItem(null);
          setNewItem({
            name: '',
            category: 'House',
            lastPurchased: new Date().toISOString().split('T')[0],
            estimatedDurationDays: 30
          });
        } else {
          alert('Failed to update item');
        }
      } catch (error) {
        console.error('Error updating item:', error);
        alert('Error updating item');
      }
    }
  };

  const handleDeleteItem = async (id) => {
    if (window.confirm('Are you sure you want to delete this item?')) {
      try {
        const response = await fetch(`${API_BASE_URL}/items/${id}`, {
          method: 'DELETE',
        });
        
        if (response.ok) {
          await fetchItems();
        } else {
          alert('Failed to delete item');
        }
      } catch (error) {
        console.error('Error deleting item:', error);
        alert('Error deleting item');
      }
    }
  };

  const sendManualReminder = async () => {
    try {
      setSendingEmail(true);
      const response = await fetch(`${API_BASE_URL}/send-reminder`, {
        method: 'POST',
      });
      
      if (response.ok) {
        const result = await response.json();
        alert(result.message);
      } else {
        alert('Failed to send reminder');
      }
    } catch (error) {
      console.error('Error sending reminder:', error);
      alert('Error sending reminder');
    } finally {
      setSendingEmail(false);
    }
  };

  const processNaturalLanguageResponse = async () => {
    setProcessingResponse(true);
    
    try {
      console.log('Processing natural language response:', emailResponse);
      
      const response = await fetch(`${API_BASE_URL}/process-response`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          response: emailResponse
        }),
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('Process response result:', result);
        
        // Clear the input FIRST
        setEmailResponse('');
        
        // Force a fresh fetch of items with a small delay to ensure backend has processed
        setTimeout(async () => {
          console.log('Refreshing items list...');
          await fetchItems();
          console.log('Items refreshed');
        }, 500);
        
        // Show the result message
        alert(`${result.message}\n\n${result.updatesApplied?.join('\n') || 'No updates applied'}`);
        
      } else {
        const errorText = await response.text();
        console.error('Failed to process response:', errorText);
        alert('Failed to process response');
      }
    } catch (error) {
      console.error('Error processing response:', error);
      alert('Error processing response');
    }
    
    setProcessingResponse(false);
  };

  const getDaysUntilNeeded = (item) => {
    const lastPurchased = new Date(item.last_purchased);
    const nextPurchaseDate = new Date(lastPurchased);
    nextPurchaseDate.setDate(lastPurchased.getDate() + item.estimated_duration_days);
    
    const today = new Date();
    const daysUntil = Math.ceil((nextPurchaseDate - today) / (1000 * 60 * 60 * 24));
    
    return daysUntil;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading Paul's Pantry...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Paul's Pantry</h1>
          <p className="text-gray-600">Household essentials reminder system</p>
          
          {/* Simple Stats */}
          <div className="grid grid-cols-3 gap-4 mt-4">
            <div 
              className="p-3 bg-blue-50 rounded-lg cursor-pointer hover:bg-blue-100 transition-colors"
              onClick={() => {setActiveTab('items'); setFilterMode('all');}}
            >
              <div className="text-xl font-bold text-blue-600">{items.length}</div>
              <div className="text-sm text-blue-700">Items tracked</div>
            </div>
            <div 
              className="p-3 bg-orange-50 rounded-lg cursor-pointer hover:bg-orange-100 transition-colors"
              onClick={() => {setActiveTab('items'); setFilterMode('upcoming');}}
            >
              <div className="text-xl font-bold text-orange-600">{upcomingItems.length}</div>
              <div className="text-sm text-orange-700">Upcoming</div>
            </div>
            <div 
              className="p-3 bg-green-50 rounded-lg cursor-pointer hover:bg-green-100 transition-colors"
              onClick={() => {setActiveTab('items'); setFilterMode('recent');}}
            >
              <div className="text-xl font-bold text-green-600">{recentItems.length}</div>
              <div className="text-sm text-green-700">Recently purchased</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div className="bg-white rounded-lg shadow-sm mb-6">
          <div className="flex border-b">
            <button
              onClick={() => setActiveTab('items')}
              className={`flex-1 py-4 px-6 text-center ${
                activeTab === 'items' 
                  ? 'border-b-2 border-blue-500 text-blue-600' 
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Items ({items.length})
            </button>
            <button
              onClick={() => setActiveTab('reminders')}
              className={`flex-1 py-4 px-6 text-center ${
                activeTab === 'reminders' 
                  ? 'border-b-2 border-blue-500 text-blue-600' 
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Send Reminder ({upcomingItems.length})
            </button>
          </div>
        </div>

        {/* Items Tab */}
        {activeTab === 'items' && (
          <div className="bg-white rounded-lg shadow-sm">
            <div className="p-6 border-b">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-semibold">
                    {filterMode === 'upcoming' ? '🛒 Shopping List' : 
                     filterMode === 'recent' ? '📦 Recently Purchased' : 
                     'Household Items'}
                  </h2>
                  {filterMode !== 'all' && (
                    <button 
                      onClick={() => setFilterMode('all')}
                      className="text-sm text-blue-600 hover:text-blue-800 mt-1"
                    >
                      ← Show all items
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  {filterMode === 'all' && (
                    <>
                      <button
                        onClick={() => setFilterMode('upcoming')}
                        className="bg-orange-500 text-white px-3 py-2 rounded-lg hover:bg-orange-600 flex items-center gap-1 text-sm"
                      >
                        <ShoppingCart size={16} />
                        Shopping List ({upcomingItems.length})
                      </button>
                      <button
                        onClick={() => setFilterMode('recent')}
                        className="bg-green-500 text-white px-3 py-2 rounded-lg hover:bg-green-600 flex items-center gap-1 text-sm"
                      >
                        <Package size={16} />
                        Recent ({recentItems.length})
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setShowAddForm(true)}
                    className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 flex items-center gap-2"
                  >
                    <Plus size={20} />
                    Add Item
                  </button>
                </div>
              </div>
            </div>

            {/* Add/Edit Form */}
            {(showAddForm || editingItem) && (
              <div className="p-6 border-b bg-gray-50">
                <h3 className="text-lg font-medium mb-4">
                  {editingItem ? 'Edit Item' : 'Add New Item'}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Item Name
                    </label>
                    <input
                      type="text"
                      value={newItem.name}
                      onChange={(e) => setNewItem({...newItem, name: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g., Dog food"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Category
                    </label>
                    <select
                      value={newItem.category}
                      onChange={(e) => setNewItem({...newItem, category: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {categories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Last Purchased
                    </label>
                    <input
                      type="date"
                      value={newItem.lastPurchased}
                      onChange={(e) => setNewItem({...newItem, lastPurchased: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Frequency
                    </label>
                    <select
                      value={newItem.estimatedDurationDays}
                      onChange={(e) => setNewItem({...newItem, estimatedDurationDays: parseInt(e.target.value)})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {frequencyOptions.map(freq => (
                        <option key={freq.days} value={freq.days}>{freq.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={editingItem ? handleUpdateItem : handleAddItem}
                    className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600"
                  >
                    {editingItem ? 'Update' : 'Add'} Item
                  </button>
                  <button
                    onClick={() => {
                      setShowAddForm(false);
                      setEditingItem(null);
                      setNewItem({
                        name: '',
                        category: 'House',
                        lastPurchased: new Date().toISOString().split('T')[0],
                        estimatedDurationDays: 30
                      });
                    }}
                    className="bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Items List */}
            <div>
              {categories.map(category => {
                let categoryItems = items.filter(item => item.category === category);
                
                // Apply filtering
                if (filterMode === 'upcoming') {
                  categoryItems = categoryItems.filter(item => upcomingItems.includes(item));
                } else if (filterMode === 'recent') {
                  categoryItems = categoryItems.filter(item => recentItems.includes(item));
                }
                
                if (categoryItems.length === 0) return null;
                
                const categoryIcon = category === 'House' ? '🏠' : 
                                    category === 'Baby' ? '👶' : 
                                    category === 'Pet' ? '🐕' : 
                                    category === 'Food' ? '🍯' : 
                                    category === 'Car' ? '🚗' : '📦';
                
                const categoryName = category === 'House' ? 'Household' : 
                                    category === 'Baby' ? 'Baby' : 
                                    category === 'Pet' ? 'Pet' : 
                                    category === 'Food' ? 'Food' : 
                                    category === 'Car' ? 'Car' : category;
                
                return (
                  <div key={category}>
                    <div className="px-6 py-3 bg-gray-50 border-b">
                      <h3 className="font-semibold text-gray-700 flex items-center gap-2">
                        <span>{categoryIcon}</span>
                        {categoryName} ({categoryItems.length})
                      </h3>
                    </div>
                    <div className="divide-y">
                      {categoryItems.map(item => {
                        const daysUntil = getDaysUntilNeeded(item);
                        const isUpcoming = upcomingItems.includes(item);
                        const isRecent = recentItems.includes(item);
                        const isOverdue = daysUntil < 0;
                        
                        return (
                          <div key={item.id} className="p-4 flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{item.name}</span>
                                <span className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-600">
                                  {getFrequencyLabel(item.estimated_duration_days)}
                                </span>
                                {isOverdue && (
                                  <span className="px-2 py-1 rounded text-xs bg-red-100 text-red-600">
                                    Overdue
                                  </span>
                                )}
                                {isUpcoming && !isOverdue && (
                                  <span className="px-2 py-1 rounded text-xs bg-orange-100 text-orange-600">
                                    Upcoming
                                  </span>
                                )}
                                {isRecent && (
                                  <span className="px-2 py-1 rounded text-xs bg-green-100 text-green-600">
                                    Recent
                                  </span>
                                )}
                              </div>
                              <div className="text-sm text-gray-600 mt-1">
                                Last purchased: {new Date(item.last_purchased).toLocaleDateString()}
                                {' • '}
                                {daysUntil > 0 ? `${daysUntil} days left` : `${Math.abs(daysUntil)} days overdue`}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleEditItem(item)}
                                className="p-2 text-blue-500 hover:bg-blue-50 rounded"
                              >
                                <Edit2 size={16} />
                              </button>
                              <button
                                onClick={() => handleDeleteItem(item.id)}
                                className="p-2 text-red-500 hover:bg-red-50 rounded"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              
              {/* Empty state for filters */}
              {((filterMode === 'upcoming' && upcomingItems.length === 0) || 
                (filterMode === 'recent' && recentItems.length === 0)) && (
                <div className="p-12 text-center text-gray-500">
                  {filterMode === 'upcoming' ? 
                    'No items need purchasing in the next 7 days! 🎉' :
                    'No items were purchased in the last 7 days'
                  }
                </div>
              )}
            </div>
          </div>
        )}

        {/* Reminders Tab */}
        {activeTab === 'reminders' && (
          <div className="bg-white rounded-lg shadow-sm">
            <div className="p-6 border-b">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <Mail size={20} />
                  Send Reminder
                </h2>
                <button
                  onClick={sendManualReminder}
                  disabled={sendingEmail}
                  className="bg-purple-500 text-white px-4 py-2 rounded-lg hover:bg-purple-600 disabled:bg-gray-300 flex items-center gap-2"
                >
                  <Mail size={16} />
                  {sendingEmail ? 'Sending...' : 'Send Reminder Now'}
                </button>
              </div>
            </div>
            
            <div className="p-6">
              <div className="bg-blue-50 rounded-lg p-4 mb-4">
                <h3 className="font-medium mb-2">✨ Natural Language Updates:</h3>
                <div className="text-sm text-gray-600">
                  <p>• "Dog food good for 2 weeks, washing powder nearly out"</p>
                  <p>• "We're out of fairy liquid" (adds new item)</p>
                  <p>• "Fairy liquid, every 4 weeks" (adds with duration)</p>
                  <p>• "Don't need baby formula anymore" (removes item)</p>
                </div>
              </div>
              
              <textarea
                value={emailResponse}
                onChange={(e) => setEmailResponse(e.target.value)}
                placeholder="Example: Dog food good for 2 weeks, washing powder nearly out, toilet roll ordered for tomorrow"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
                rows="4"
              />
              
              <button
                onClick={processNaturalLanguageResponse}
                disabled={!emailResponse.trim() || processingResponse}
                className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Clock size={16} />
                {processingResponse ? 'Processing...' : 'Process Update'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PaulsPantry;