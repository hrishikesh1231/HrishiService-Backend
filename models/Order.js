const mongoose = require('mongoose');
const { OrderSchema } = require('../Schema/OrderSchema');

const Order = mongoose.model('order', OrderSchema); //

module.exports = {Order};
