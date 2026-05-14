
require('dotenv').config()
const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const jwt = require('jsonwebtoken')
const morgan = require('morgan')
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)

const port = process.env.PORT || 5000
const app = express()

const corsOptions = {
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'https://medi-quest-c6cb9.web.app',
  ],
  credentials: true,
  optionSuccessStatus: 200,
}
app.use(cors(corsOptions))
app.use(express.json())
app.use(cookieParser())
app.use(morgan('dev'))

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@mycluster1.rs796.mongodb.net/?retryWrites=true&w=majority&appName=myCluster1`

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})

// Verify JWT
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).send({ message: 'Unauthorised access' })
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: 'Unauthorised access' })
    }
    req.user = decoded
    next()
  })
}

async function run() {
  try {
    const db = client.db('MediQuest_2')
    const userCollection = db.collection('users')
    const medicinesCollection = db.collection('medicines')
    const ordersCollection = db.collection('orders')
    const categoriesCollection = db.collection('categories')
    const paymentsCollection = db.collection('payments')
    const advertisementsCollection = db.collection('advertisements')

    // Role middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.user?.email
      const result = await userCollection.findOne({ email })
      if (!result || result?.role !== 'admin')
        return res.status(403).send({ message: 'Forbidden access! Admin only' })
      next()
    }

    const verifySeller = async (req, res, next) => {
      const email = req.user?.email
      const result = await userCollection.findOne({ email })
      if (!result || result?.role !== 'seller')
        return res.status(403).send({ message: 'Forbidden access! Seller only' })
      next()
    }

    // AUTH

    app.post('/jwt', async (req, res) => {
      const email = req.body
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true, token })
    })

    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
      } catch (err) {
        res.status(500).send(err)
      }
    })

    // USERS

    app.post('/users/:email', async (req, res) => {
      const email = req.params.email
      const user = req.body
      const isExist = await userCollection.findOne({ email })
      if (isExist) {
        return res.send(isExist)
      }
      const result = await userCollection.insertOne({
        ...user,
        role: user.role || 'customer',
        status: 'verified',
        timestamp: Date.now(),
      })
      res.send(result)
    })

    app.patch('/users/:email', verifyToken, async (req, res) => {
      const email = req.params.email
      const user = await userCollection.findOne({ email })
      if (!user || user?.status === 'requested') {
        return res.status(400).send({ message: 'Already requested, please wait' })
      }
      const result = await userCollection.updateOne(
        { email },
        { $set: { status: 'requested' } }
      )
      res.send(result)
    })

    app.get('/all-users/:email', verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email
      const result = await userCollection.find({ email: { $ne: email } }).toArray()
      res.send(result)
    })

    app.get('/user/:email', verifyToken, async (req, res) => {
      const email = req.params.email
      const user = await userCollection.findOne({ email })
      if (!user) return res.status(404).send({ message: 'User not found' })
      res.send(user)
    })

    app.put('/update-profile', verifyToken, async (req, res) => {
      const { email, displayName, photoURL } = req.body
      if (!email) return res.status(400).send({ message: 'Email is required' })
      const result = await userCollection.updateOne(
        { email },
        { $set: { displayName, photoURL } }
      )
      if (result.modifiedCount > 0) {
        res.send({ message: 'Profile updated successfully' })
      } else {
        res.status(400).send({ message: 'No changes detected' })
      }
    })

    app.get('/users/role/:email', async (req, res) => {
      const email = req.params.email
      const result = await userCollection.findOne({ email })
      res.send(result || {})
    })

    app.patch('/users/role/:email', verifyToken, async (req, res) => {
      const email = req.params.email
      const { role } = req.body
      const result = await userCollection.updateOne(
        { email },
        { $set: { role, status: 'verified' } }
      )
      res.send(result)
    })

    //  CATEGORIES

    const categoryCount = await categoriesCollection.countDocuments()
    if (categoryCount === 0) {
      await categoriesCollection.insertMany([
        { name: 'General', image: 'https://i.pinimg.com/736x/ab/dd/86/abdd86bdf15f836984614d9632f767af.jpg' },
        { name: 'Prescribed', image: 'https://i.pinimg.com/736x/d1/a6/89/d1a68989dd575390ef9d18d0e11fcc7d.jpg' },
        { name: 'Infectious', image: 'https://i.pinimg.com/736x/65/0e/9b/650e9b057cc715ffe1128759fcd2c281.jpg' },
        { name: 'Veterinary', image: 'https://i.pinimg.com/736x/27/ee/92/27ee92a68141a60fd923d5f8eb23c13f.jpg' },
        { name: 'Ointment', image: 'https://i.pinimg.com/736x/83/41/14/834114c36b2de6e52ba34b25e38666dd.jpg' },
        { name: 'Suppliment', image: 'https://i.pinimg.com/736x/89/8f/14/898f14df25a037b725c607af884a022f.jpg' },
      ])
    }

    app.get('/categories', async (req, res) => {
      const categories = await categoriesCollection.find().toArray()
      const counts = await medicinesCollection
        .aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }])
        .toArray()
      const countMap = {}
      counts.forEach((c) => (countMap[c._id] = c.count))
      const result = categories.map((cat) => ({
        ...cat,
        medicineCount: countMap[cat.name] || 0,
      }))
      res.send(result)
    })

    app.post('/categories', verifyToken, verifyAdmin, async (req, res) => {
      const { name, image } = req.body
      const exists = await categoriesCollection.findOne({ name })
      if (exists) return res.status(400).send({ message: 'Category already exists' })
      const result = await categoriesCollection.insertOne({ name, image })
      res.send(result)
    })

    app.patch('/categories/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id
      const { name, image } = req.body
      const result = await categoriesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { name, image } }
      )
      res.send(result)
    })

    app.delete('/categories/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id
      const result = await categoriesCollection.deleteOne({ _id: new ObjectId(id) })
      res.send(result)
    })

    // MEDICINES

    app.post('/medicines', verifyToken, verifySeller, async (req, res) => {
      const med = req.body
      const result = await medicinesCollection.insertOne(med)
      res.send(result)
    })

    app.get('/medicines', async (req, res) => {
      const page = parseInt(req.query.page) || 1
      const limit = parseInt(req.query.limit) || 0
      const search = req.query.search || ''
      const sort = req.query.sort || ''
      const category = req.query.category || ''

      let query = {}
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { genericName: { $regex: search, $options: 'i' } },
          { company: { $regex: search, $options: 'i' } },
          { category: { $regex: search, $options: 'i' } },
        ]
      }
      if (category) {
        query.category = category
      }

      let sortOption = {}
      if (sort === 'asc') sortOption = { price: 1 }
      else if (sort === 'desc') sortOption = { price: -1 }

      const skip = limit > 0 ? (page - 1) * limit : 0
      const total = await medicinesCollection.countDocuments(query)
      let cursor = medicinesCollection.find(query).sort(sortOption)
      if (limit > 0) {
        cursor = cursor.skip(skip).limit(limit)
      }
      const result = await cursor.toArray()
      res.send({ medicines: result, total })
    })

    app.get('/medicines/discount', async (req, res) => {
      const result = await medicinesCollection.find({ discount: { $gt: 0 } }).toArray()
      res.send(result)
    })

    app.get('/medicines/category/:category', async (req, res) => {
      const category = req.params.category
      const page = parseInt(req.query.page) || 1
      const limit = parseInt(req.query.limit) || 10
      const search = req.query.search || ''
      const sort = req.query.sort || ''

      let query = { category }
      if (search) {
        query.$and = [
          { category },
          {
            $or: [
              { name: { $regex: search, $options: 'i' } },
              { genericName: { $regex: search, $options: 'i' } },
              { company: { $regex: search, $options: 'i' } },
            ],
          },
        ]
        delete query.category
      }

      let sortOption = {}
      if (sort === 'asc') sortOption = { price: 1 }
      else if (sort === 'desc') sortOption = { price: -1 }

      const total = await medicinesCollection.countDocuments(query)
      const result = await medicinesCollection
        .find(query)
        .sort(sortOption)
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray()
      res.send({ medicines: result, total })
    })

    app.get('/medicines/:id', async (req, res) => {
      const id = req.params.id
      const result = await medicinesCollection.findOne({ _id: new ObjectId(id) })
      res.send(result)
    })

    app.get('/meds/seller', verifyToken, verifySeller, async (req, res) => {
      const email = req.user.email
      const result = await medicinesCollection.find({ 'seller.email': email }).toArray()
      res.send(result)
    })

    app.delete('/medicines/:id', verifyToken, verifySeller, async (req, res) => {
      const id = req.params.id
      const result = await medicinesCollection.deleteOne({ _id: new ObjectId(id) })
      res.send(result)
    })

    app.put('/medicines/:id', verifyToken, verifySeller, async (req, res) => {
      const id = req.params.id
      const updateData = req.body
      delete updateData._id
      const result = await medicinesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData }
      )
      res.send(result)
    })

    app.patch('/medicines/quantity/:id', verifyToken, async (req, res) => {
      const id = req.params.id
      const { quantityToUpdate, status } = req.body
      const inc = status === 'increase' ? quantityToUpdate : -quantityToUpdate
      const result = await medicinesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $inc: { quantity: inc } }
      )
      res.send(result)
    })

    //  ORDERS

    app.post('/order', verifyToken, async (req, res) => {
      const orderInfo = req.body
      const result = await ordersCollection.insertOne(orderInfo)
      res.send(result)
    })

    app.get('/customer-orders/:email', verifyToken, async (req, res) => {
      const email = req.params.email
      const result = await ordersCollection
        .aggregate([
          { $match: { 'customer.email': email } },
          { $addFields: { medId: { $toObjectId: '$medId' } } },
          {
            $lookup: {
              from: 'medicines',
              localField: 'medId',
              foreignField: '_id',
              as: 'medicines',
            },
          },
          { $unwind: '$medicines' },
          {
            $addFields: {
              name: '$medicines.name',
              image: '$medicines.image',
              category: '$medicines.category',
            },
          },
          { $project: { medicines: 0 } },
        ])
        .toArray()
      res.send(result)
    })

    app.get('/seller-orders/:email', verifyToken, verifySeller, async (req, res) => {
      const email = req.params.email
      const result = await ordersCollection
        .aggregate([
          { $match: { seller: email } },
          { $addFields: { medId: { $toObjectId: '$medId' } } },
          {
            $lookup: {
              from: 'medicines',
              localField: 'medId',
              foreignField: '_id',
              as: 'medicines',
            },
          },
          { $unwind: '$medicines' },
          { $addFields: { name: '$medicines.name' } },
          { $project: { medicines: 0 } },
        ])
        .toArray()
      res.send(result)
    })

    app.delete('/order/:id', verifyToken, async (req, res) => {
      const id = req.params.id
      const order = await ordersCollection.findOne({ _id: new ObjectId(id) })
      if (order?.status === 'delivered') {
        return res.status(409).send({ message: 'Order already delivered' })
      }
      const result = await ordersCollection.deleteOne({ _id: new ObjectId(id) })
      res.send(result)
    })

    app.patch('/orders/:id', verifyToken, verifySeller, async (req, res) => {
      const id = req.params.id
      const { status } = req.body
      const result = await ordersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      )
      res.send(result)
    })

    // PAYMENTS

    app.post('/create-payment-intent', verifyToken, async (req, res) => {
      const { amount } = req.body
      if (!amount || amount <= 0) {
        return res.status(400).send({ message: 'Invalid amount' })
      }
      const totalPrice = Math.round(amount * 100)
      const { client_secret } = await stripe.paymentIntents.create({
        amount: totalPrice,
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
      })
      res.send({ clientSecret: client_secret })
    })

    app.post('/payments', verifyToken, async (req, res) => {
      const paymentData = req.body
      const result = await paymentsCollection.insertOne({
        ...paymentData,
        status: 'pending',
        date: new Date(),
      })
      res.send(result)
    })

    // Admin: all payments
    app.get('/admin/payments', verifyToken, verifyAdmin, async (req, res) => {
      const result = await paymentsCollection.find().sort({ date: -1 }).toArray()
      res.send(result)
    })

    // Admin: accept payment
    app.patch('/admin/payments/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id
      const result = await paymentsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: 'paid' } }
      )
      res.send(result)
    })

    // User payment history
    app.get('/payments/:email', verifyToken, async (req, res) => {
      const email = req.params.email
      const result = await paymentsCollection.find({ buyerEmail: email }).sort({ date: -1 }).toArray()
      res.send(result)
    })

    // Seller payment history
    app.get('/seller-payments/:email', verifyToken, verifySeller, async (req, res) => {
      const email = req.params.email
      const result = await paymentsCollection
        .find({ 'items.sellerEmail': email })
        .sort({ date: -1 })
        .toArray()
      res.send(result)
    })

    // ── SALES REPORT (Admin) ──

    app.get('/admin/sales-report', verifyToken, verifyAdmin, async (req, res) => {
      const { startDate, endDate } = req.query
      let match = {}
      if (startDate && endDate) {
        match.date = {
          $gte: new Date(startDate),
          $lte: new Date(endDate + 'T23:59:59.999Z'),
        }
      }
      const result = await paymentsCollection.find(match).sort({ date: -1 }).toArray()
      res.send(result)
    })

    // ── ADVERTISEMENTS / BANNERS ──

    app.post('/advertisements', verifyToken, verifySeller, async (req, res) => {
      const adData = req.body
      const result = await advertisementsCollection.insertOne({
        ...adData,
        status: 'pending',
        inSlider: false,
      })
      res.send(result)
    })

    app.get('/advertisements/seller/:email', verifyToken, verifySeller, async (req, res) => {
      const email = req.params.email
      const result = await advertisementsCollection.find({ sellerEmail: email }).toArray()
      res.send(result)
    })

    app.get('/admin/advertisements', verifyToken, verifyAdmin, async (req, res) => {
      const result = await advertisementsCollection.find().toArray()
      res.send(result)
    })

    app.patch('/admin/advertisements/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id
      const ad = await advertisementsCollection.findOne({ _id: new ObjectId(id) })
      const result = await advertisementsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { inSlider: !ad.inSlider } }
      )
      res.send(result)
    })

    app.get('/slider-banners', async (req, res) => {
      const result = await advertisementsCollection.find({ inSlider: true }).toArray()
      res.send(result)
    })

    // ── STATISTICS ──

    app.get('/admin-stat', verifyToken, verifyAdmin, async (req, res) => {
      const totalUser = await userCollection.countDocuments()
      const totalMedicines = await medicinesCollection.estimatedDocumentCount()

      const paidPayments = await paymentsCollection
        .aggregate([
          { $match: { status: 'paid' } },
          { $group: { _id: null, total: { $sum: '$totalAmount' } } },
        ])
        .next()

      const pendingPayments = await paymentsCollection
        .aggregate([
          { $match: { status: 'pending' } },
          { $group: { _id: null, total: { $sum: '$totalAmount' } } },
        ])
        .next()

      const orderDetails = await paymentsCollection
        .aggregate([
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: '$totalAmount' },
              totalOrder: { $sum: 1 },
            },
          },
          { $project: { _id: 0 } },
        ])
        .next()

      const chartData = await paymentsCollection
        .aggregate([
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
              price: { $sum: '$totalAmount' },
              order: { $sum: 1 },
            },
          },
          { $project: { _id: 0, date: '$_id', price: 1, order: 1 } },
          { $sort: { date: 1 } },
        ])
        .toArray()

      res.send({
        totalMedicines,
        totalUser,
        paidTotal: paidPayments?.total || 0,
        pendingTotal: pendingPayments?.total || 0,
        ...orderDetails,
        chartData,
      })
    })

    app.get('/seller-stat/:email', verifyToken, verifySeller, async (req, res) => {
      const email = req.params.email

      const paidPayments = await paymentsCollection
        .aggregate([
          { $match: { status: 'paid', 'items.sellerEmail': email } },
          { $unwind: '$items' },
          { $match: { 'items.sellerEmail': email } },
          {
            $group: {
              _id: null,
              total: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
            },
          },
        ])
        .next()

      const pendingPayments = await paymentsCollection
        .aggregate([
          { $match: { status: 'pending', 'items.sellerEmail': email } },
          { $unwind: '$items' },
          { $match: { 'items.sellerEmail': email } },
          {
            $group: {
              _id: null,
              total: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
            },
          },
        ])
        .next()

      res.send({
        paidTotal: paidPayments?.total || 0,
        pendingTotal: pendingPayments?.total || 0,
      })
    })

  } finally {
    // client closes when process exits
  }
}

run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from MediQuest Server 2..')
})

app.listen(port, () => {
  console.log(`MediQuest is running on port ${port}`)
})
