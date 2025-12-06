require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('../src/models/User');

async function createAdmin() {
  try {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');

    await mongoose.connect(process.env.MONGODB_URI);

    const email = process.argv[2] || 'admin@eduhive.com';
    const password = process.argv[3] || 'admin123';
    const name = process.argv[4] || 'Admin User';

    const existing = await User.findOne({ email });
    if (existing) {
      console.log(`User with email ${email} already exists. Updating to admin...`);
      existing.role = 'admin';
      existing.name = name;
      if (password !== 'admin123') {
        existing.password = await bcrypt.hash(password, 10);
      }
      await existing.save();
      console.log('✅ Admin user updated successfully!');
    } else {
      const hash = await bcrypt.hash(password, 10);
      await User.create({
        email,
        password: hash,
        role: 'admin',
        name,
      });
      console.log('✅ Admin user created successfully!');
    }

    console.log(`\nEmail: ${email}`);
    console.log(`Password: ${password}`);
    console.log(`Role: admin\n`);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

createAdmin();

