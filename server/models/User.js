// server/models/User.js
const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, "Please provide an email"],
    unique: true,
    match: [
      /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
      "Please provide a valid email",
    ],
  },
  password: {
    type: String,
    required: [true, "Please add a password"],
    minlength: 6,
  },
  role: { type: String, enum: ['student', 'cca', 'senate'], default: 'student' },
  ccaAssignment: { type: mongoose.Schema.Types.ObjectId, ref: 'CCA', default: null },
  fullName: { type: String, default: '' },
  rollNumber: { type: String, default: '' },
  appliedCCAs: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CCA",
    },
  ],
  rankedCCAs: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CCA'
  }],
  cvs: [{
    filename: { type: String, required: true },
    storedFilename: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    hash: { type: String, required: true },
    uploadedAt: { type: Date, default: Date.now }
  }],
  applicationCVs: [{
    cca: { type: mongoose.Schema.Types.ObjectId, ref: 'CCA', required: true },
    cv: { type: mongoose.Schema.Types.ObjectId, required: true }
  }],
  selectionApplications: [{
    cca: { type: mongoose.Schema.Types.ObjectId, ref: 'CCA', required: true },
    cv: { type: mongoose.Schema.Types.ObjectId, default: null },
    vertical: { type: String, default: 'General' },
    preference: { type: Number, default: 0 },
    status: { type: String, default: 'Applied' },
    createdAt: { type: Date, default: Date.now }
  }]
});

module.exports = mongoose.model("User", UserSchema);
