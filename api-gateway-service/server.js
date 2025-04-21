const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const app = express();
const port = process.env.PORT || 3000;
const jwtSecret = process.env.JWT_SECRET || 'your_jwt_secret';

const productServiceUrl = process.env.PRODUCT_SERVICE_URL || 'http://product-service:3001';
const orderServiceUrl = process.env.ORDER_SERVICE_URL || 'http://order-service:3002';
const userServiceUrl = process.env.USER_SERVICE_URL || 'http://user-service:3003';

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100, 
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' }
});

app.use(apiLimiter);

const authenticate = (req, res, next) => {
  if (req.path === '/api/auth/login' || 
      req.path === '/api/auth/register' || 
      (req.path.startsWith('/api/products') && req.method === 'GET') ||
      req.path === '/health') {
    return next();
  }
  
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  
  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.user = decoded;
    
    req.headers['user-id'] = decoded.id;
    req.headers['user-role'] = decoded.role;
    
    next();
  } catch (err) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

app.use(authenticate);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/api/products', createProxyMiddleware({
  target: productServiceUrl,
  changeOrigin: true,
  pathRewrite: {
    '^/api/products': '/api/products'
  },
  onError: (err, req, res) => {
    res.status(500).json({ message: 'Product service is unavailable' });
  }
}));

app.use('/api/orders', createProxyMiddleware({
  target: orderServiceUrl,
  changeOrigin: true,
  pathRewrite: {
    '^/api/orders': '/api/orders'
  },
  onError: (err, req, res) => {
    res.status(500).json({ message: 'Order service is unavailable' });
  }
}));

app.use('/api/users', createProxyMiddleware({
  target: userServiceUrl,
  changeOrigin: true,
  pathRewrite: {
    '^/api/users': '/api/users'
  },
  onError: (err, req, res) => {
    res.status(500).json({ message: 'User service is unavailable' });
  }
}));

app.use('/api/auth', createProxyMiddleware({
  target: userServiceUrl,
  changeOrigin: true,
  pathRewrite: {
    '^/api/auth': '/api/auth'
  },
  onError: (err, req, res) => {
    res.status(500).json({ message: 'Auth service is unavailable' });
  }
}));

app.listen(port, () => {
  console.log(`API Gateway running on port ${port}`);
});