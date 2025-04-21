const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3002;
const mongoUri = process.env.MONGO_URI || 'mongodb://order-db:27017/order-service';
const productServiceUrl = process.env.PRODUCT_SERVICE_URL || 'http://product-service:3001';
const userServiceUrl = process.env.USER_SERVICE_URL || 'http://user-service:3003';

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

mongoose.connect(mongoUri)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

const orderSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  items: [{
    productId: { type: String, required: true },
    quantity: { type: Number, required: true },
    price: { type: Number, required: true }
  }],
  totalAmount: { type: Number, required: true },
  status: { 
    type: String, 
    enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending'
  },
  shippingAddress: {
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    zipCode: { type: String, required: true },
    country: { type: String, required: true }
  },
  paymentMethod: { type: String, required: true },
  paymentStatus: { 
    type: String, 
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Order = mongoose.model('Order', orderSchema);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/api/orders', async (req, res) => {
  try {
    const orders = await Order.find();
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/orders/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/orders/user/:userId', async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.params.userId });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const orderData = req.body;
    
    try {
      await axios.get(`${userServiceUrl}/api/users/${orderData.userId}`);
    } catch (err) {
      return res.status(400).json({ message: 'User not found' });
    }
    
    for (const item of orderData.items) {
      try {
        const productResponse = await axios.get(`${productServiceUrl}/api/products/${item.productId}`);
        const product = productResponse.data;
        
        if (product.inventory < item.quantity) {
          return res.status(400).json({ 
            message: `Insufficient inventory for product ${product.name}`,
            productId: item.productId
          });
        }
        
        await axios.patch(
          `${productServiceUrl}/api/products/${item.productId}/inventory`,
          { quantity: -item.quantity }
        );
      } catch (err) {
        if (err.response && err.response.status === 404) {
          return res.status(400).json({ 
            message: `Product with ID ${item.productId} not found` 
          });
        }
        throw err;
      }
    }
    
    const order = new Order(orderData);
    const newOrder = await order.save();
    res.status(201).json(newOrder);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.patch('/api/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ message: 'Status is required' });
    }
    
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    
    order.status = status;
    order.updatedAt = Date.now();
    await order.save();
    
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.patch('/api/orders/:id/payment', async (req, res) => {
  try {
    const { paymentStatus } = req.body;
    if (!paymentStatus) {
      return res.status(400).json({ message: 'Payment status is required' });
    }
    
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    
    order.paymentStatus = paymentStatus;
    order.updatedAt = Date.now();
    await order.save();
    
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/orders/:id/cancel', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    
    if (order.status === 'shipped' || order.status === 'delivered') {
      return res.status(400).json({ 
        message: 'Cannot cancel order that has been shipped or delivered' 
      });
    }
    
    for (const item of order.items) {
      await axios.patch(
        `${productServiceUrl}/api/products/${item.productId}/inventory`,
        { quantity: item.quantity }
      );
    }
    
    order.status = 'cancelled';
    order.updatedAt = Date.now();
    await order.save();
    
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.listen(port, () => {
  console.log(`Order service running on port ${port}`);
});