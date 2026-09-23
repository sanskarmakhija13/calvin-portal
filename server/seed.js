const mongoose = require('mongoose');
const CCA = require('./models/CCA');
require('dotenv').config();

const DRIVE_ROOT = 'https://drive.google.com/drive/u/0/folders/19dO_meYuN45j3hnoYbjqEBzEJrRffX4r';
const base = { logo: '/logos/generic.svg', brandColor: '#f58220', fontFamily: 'Arial, sans-serif', memberLimit: 'Not provided', stexLimit: 'Not provided', majorEvents: [], driveUrl: DRIVE_ROOT, phase1Eligible: true, phase2Eligible: false };
const item = (name, category, description, extra = {}) => ({ ...base, name, category, description, ...extra });
const detail = (logoText, memberLimit, stexLimit, majorEvents, extra = {}) => ({ logoText, memberLimit, stexLimit, majorEvents, ...extra });

const ccaData = [
  item('Alumni Committee', 'Committees', 'Builds and sustains meaningful connections with the IIM Lucknow alumni network.', { logo: '/logos/alumni.svg', ...detail('ALUMNI', 'Not provided', 'Not provided', ['Alumni meets', 'Mentorship', 'Alumni engagement'], { brandColor: '#171717' }) }),
  item('Bhavishya', 'Committees', 'A social initiatives committee working to improve lives on and around campus.', { logo: '/logos/bhavishya.svg', ...detail('BHAVISHYA', '9', '2', ['Evening School', 'Community Visit', 'Harmony Cup', 'Blood Donation Camp', 'Fundraisers'], { brandColor: '#1d7a67' }) }),
  item('Cultural Committee', 'Committees', 'Creates the campus calendar of cultural celebrations, community events, and shared traditions.', { logo: '/logos/cultural.svg', ...detail('CULTURAL', '10', '3', ['Parichay', 'Camaraderie', 'CultCon', 'Farewell', 'Dandiya Night', 'Holi'], { brandColor: '#d33e42' }) }),
  item('Entrepreneurship Cell', 'Committees', 'Fosters the entrepreneurial spirit through competitions, speakers, projects, and founder connect.', { logo: '/logos/ecell.svg', ...detail('E-CELL', '6', '1', ['E-Summit', 'Business competitions', 'Speaker sessions', 'Podcasts', 'Live projects'], { brandColor: '#f4c400' }) }),
  item('Industry Interaction Cell', 'Committees', 'The oldest IIM Lucknow committee, connecting students with industry leaders and changemakers.', { logo: '/logos/iic.svg', ...detail('IIC', '7', '2', ['TEDxIIMLucknow', 'Samvit', 'ProTalks'], { brandColor: '#245b8f' }) }),
  item('Infrastructure & Audit Committee', 'Committees', 'Makes life at IIM Lucknow easier through infrastructure audits, hostel support, logistics, and vendor partnerships.', { logo: '/logos/iac.svg', ...detail('IAC', '8', '2', ['Infrastructure audits', 'Hostel maintenance', 'Campus logistics', 'Vendor deals'], { brandColor: '#1d5c85' }) }),
  item('Media and Comm. Cell', 'Committees', 'Builds the IIM Lucknow brand through social campaigns, content, PR, photography, and videography.', { logo: '/logos/mcc.svg', ...detail('MCC', '12', '3', ['Welcome Video', 'Frames', 'Yearbook Launch', 'Scribble Day'], { brandColor: '#8c1d40' }) }),
  item('Mess Committee', 'Committees', 'Runs quality, hygienic, affordable, and timely food services for the IIM Lucknow community.', { logo: '/logos/mess.svg', ...detail('MESS', '11', '3', ['Employee Day', 'Hell’s Kitchen', 'Theme Dinners', 'Night Mess Farewell', 'Placement Support'], { brandColor: '#b25b35' }) }),
  item('Sports Committee', 'Committees', 'Runs campus sports, coaching, leagues, inventory, and major athletic events for the batch.', { logo: '/logos/sports.svg', ...detail('SPORTS', '12', '3', ['Sangram', 'Manfest Varchasva', 'Foundation Day', 'Hell League'], { brandColor: '#1565a8' }) }),
  item('STEX Committee', 'Committees', 'Connects IIM Lucknow with the world and manages incoming and outgoing student exchange experiences.', { logo: '/logos/stex.svg', ...detail('STEX', '5', '0', ['Euro Dinner', 'Anubhav', 'Heritage Walk', 'Sanchar'], { brandColor: '#0f6075' }) }),
  item('Team Synapse', 'Committees', 'The technology committee of IIM Lucknow, building digital systems that improve student life.', { logo: '/logos/synapse.svg', ...detail('SYNAPSE', '10', '3', ['Dumbledore', 'Etrigan', 'Hodor', 'Orion', 'Placement Support System'], { brandColor: '#2d6cdf' }) }),
  item('Team Disha', 'Committees', 'Mentors and supports the incoming batch through one of the most important parts of their MBA journey.', { logo: '/logos/disha.svg', ...detail('DISHA', '17', '0', ['Mentor support', 'Batch guidance', 'KT sessions'], { brandColor: '#e57b25' }) }),
  item('Manfest Varchasva', 'Committees', 'Asia’s largest B-school fest, bringing business, culture, sports, speakers, artists, and participants together.', { logo: '/logos/mv.svg', ...detail('MV', '15', '0', ['Business events', 'Cultural events', 'Sports events', 'Pro Shows', 'Leaders Express'], { brandColor: '#ef3d3d' }) }),

  item('3.4 – The Music Band', 'Clubs', 'IIM Lucknow’s official band, spanning classical, rock, fusion, and international genres through campus concerts.', { logo: '/logos/three-four.svg', ...detail('THREE.FOUR', '14', '3', ['Jam Night', 'MV Musical Night', 'Parichay', 'Foundation Day', 'Independence Day'], { brandColor: '#6a3d9a' }) }),
  item('Abhivyakti – Dramatics Club', 'Clubs', 'A theatre and dramatics community for stage performance, acting, and storytelling.', { ...detail('ABHIVYAKTI', 'Not provided', 'Not provided', ['Stage productions', 'Dramatics workshops']) }),
  item('Arts-Strokes – Fine Arts Club', 'Clubs', 'The Fine Arts Club of IIM Lucknow for making, learning, and sharing visual art.', { logo: '/logos/art-strokes.svg', ...detail('ART STROKES', '6', '2', ['Art Carnival', 'Clay Modelling', 'Candle Making', 'Tote Bag Painting', 'Canvas Painting'], { brandColor: '#b34b6e' }) }),
  item('Credence Capital', 'Clubs', 'A student-run investment fund and financial analysis club.', { logo: '/logos/credence.svg', ...detail('CREDENCE', 'Not provided', 'Not provided', ['Equity research', 'Investment analysis', 'Finance workshops'], { brandColor: '#9f6255' }) }),
  item('Crank Tank - The Case Competition Club', 'Clubs', 'Builds practical problem-solving skills for national and international case competitions.', { logo: '/logos/crack-tank.svg', ...detail('CRACK TANK', 'Not provided', 'Not provided', ['Case competitions', 'Crack Tank'], { brandColor: '#12aeb5' }) }),
  item('Forty-Two – Literary Club', 'Clubs', 'A literary community for books, essays, poetry, games, and creative contests.', { logo: '/logos/forty-two.svg', ...detail('42', '6', '2', ['Jashn-E-Ishqa', 'Jazbaat', 'Inkstains'], { brandColor: '#7b2434' }) }),
  item('Orator\'s Circle', 'Clubs', 'Builds confidence, eloquence, spontaneity, and strong communication through regular speaking practice.', { logo: '/logos/orators.svg', ...detail('ORATOR’S', '7', '2', ['Orator’s Monthly Meet', 'Socrates Symposium', 'Mock to Mastery', 'Prepared Speech', 'Impromptu Rant'], { brandColor: '#7b1e3a' }) }),
  item('Lucknow Laughter Club', 'Clubs', 'A comedy community that brings stand-up, roasts, memes, and comic relief to campus life.', { logo: '/logos/llc.svg', ...detail('LLC', '8', '2', ['Bhadaas', 'The Final Rant', 'Stand-up shows', 'Comedy content'], { brandColor: '#e64a19' }) }),
  item('Public Policy Club', 'Clubs', 'Creates dialogue on public policy through discussions, simulations, competitions, live projects, and research.', { logo: '/logos/ppc.svg', ...detail('PPC', '7', '2', ['Aarambh', 'Mock Parliament', 'Themis Hackathon', 'Crepidoma Case Competition', 'Policy Manch'], { brandColor: '#263c74' }) }),
  item('Rang - The Pride Club', 'Clubs', 'IIM Lucknow’s diversity, equity, and inclusion initiative, creating a safe and supportive space for underrepresented communities.', { logo: '/logos/rang.svg', ...detail('RANG', '5', '2', ['Egalite', 'Samavesh', 'Awadh Queer Pride', 'India Included'], { brandColor: '#9c286e' }) }),
  item('Random Walk – Dance Club', 'Clubs', 'The IIM Lucknow dance club where performance, passion, friendship, and movement come together.', { logo: '/logos/random-walk.svg', ...detail('RANDOM WALK', '12', '3', ['Prom Launch', 'Salsa Workshop', 'Promenade', 'Republic Day Performance'], { brandColor: '#e33d69' }) }),
  item('Right Angles – Photography', 'Clubs', 'Turns campus moments into memories through photography, event coverage, and visual storytelling.', { logo: '/logos/right-angles.svg', ...detail('RIGHT ANGLES', 'Not provided', 'Not provided', ['Manfest Varchasva', 'Gaming Night', 'Sangharsh', 'Mess Farewell'], { brandColor: '#1f4d72' }) }),
  item('Spic Macay – IIML Chapter', 'Clubs', 'Promotes Indian classical music, dance, heritage, and regional art forms among young people.', { logo: '/logos/spic-macay.svg', ...detail('SPIC MACAY', '6', '0', ['Virasat', 'Shubharambh', 'Dharohar', 'Aarohan', 'Heritage Walk', 'Cultural Quiz'], { brandColor: '#8c2e3b' }) }),
  item('ShARE chapter', 'Clubs', 'A student-run consultancy working on real-world projects and social impact.', { ...detail('ShARE', 'Not provided', 'Not provided', ['Consulting projects', 'Impact initiatives']) }),
  item('Tails & Tales', 'Clubs', 'IIM Lucknow’s animal welfare club, working for safer coexistence between campus animals and people.', { logo: '/logos/tails-tales.svg', ...detail('T&T', '5', '2', ['Feeding Programme', 'Fund a Furball', 'Medical Care', 'Vaccinations and Sterilisation'], { brandColor: '#4f7f42' }) }),
  item('Quizzing Commoners', 'Clubs', 'Builds a quizzing culture through topical quizzes, trivia leagues, national quiz fests, and inter-institute representation.', { logo: '/logos/qcomm.svg', ...detail('QCOMM', '10', '3', ['Qrioso', 'Nihilanth', 'General Quiz', 'India Quiz', 'Quizcomm campus events'], { brandColor: '#263b72' }) }),

  item('Biztech', 'AIGs', 'Explores the intersection of business, product, technology, and analytics.', { logo: '/logos/biztech.svg', ...detail('biz.tech', 'Not provided', 'Not provided', ['Product sessions', 'Tech workshops', 'Analytics events'], { brandColor: '#111111' }) }),
  item('Consulting & Strategy Club', 'AIGs', 'Prepares students for management consulting through projects, cases, and strategy simulations.', { logo: '/logos/csc.svg', ...detail('CSC', '9', '2', ['Strategia Week', 'Case competitions', 'Strategy simulations'], { brandColor: '#111111' }) }),
  item('HELICS – The HR Club', 'AIGs', 'Connects HR theory with practice and industry experts while helping students build people and organisational skills.', { logo: '/logos/helics.svg', ...detail('HELICS', '4', '1', ['UDBHAV', 'Vichaar', 'Pariprekshya', 'Samavesh'], { brandColor: '#7f2d42' }) }),
  item('Interest Group in Food and Agri-Business (IGFAB)', 'AIGs', 'Builds awareness and practical problem-solving skills in agribusiness, food, environment, and rural management.', { logo: '/logos/igfab.svg', ...detail('IGFAB', '4', '1', ['FABFest', 'Markoid', 'CropFin', 'Udyog', 'Capture', 'Quizzeria', 'Kisan Vikas'], { brandColor: '#2e7d32' }) }),
  item('Operations Interest Group', 'AIGs', 'Promotes Operations Management through industry partnerships, certifications, live projects, and placement preparation.', { logo: '/logos/oig.svg', ...detail('OIG', '6', '2', ['Beer Game', 'Opsprint', 'Trilogy', 'Opsyrus', 'Opsword', 'Parakram'], { brandColor: '#1c5a86' }) }),
  item('PRISM – The Marketing Cell', 'AIGs', 'The marketing AIG where placement preparation meets live projects, brand strategy, content, and high-energy campus events.', { logo: '/logos/prism.svg', ...detail('PRISM', '8', '2', ['M-DAY', 'MarkStorm', 'Escape Room', 'Treasure Hunts', 'Guest Speaker Sessions'], { brandColor: '#e33a66' }) }),
  item('SIGFI', 'AIGs', 'The Special Interest Group in Finance for students exploring markets and financial analysis.', { ...detail('SIGFI', 'Not provided', 'Not provided', ['Finance sessions', 'Market discussions']) }),
];

async function seedDB() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('MongoDB connected for seeding...');
  await CCA.updateOne({ name: 'IIML Toastmasters Club' }, { $set: { name: "Orator's Circle" } });
  await CCA.bulkWrite(ccaData.map((cca) => ({
    updateOne: {
      filter: { name: cca.name },
      update: { $set: cca },
      upsert: true,
    },
  })));
  console.log(`Updated or added ${ccaData.length} CCAs successfully.`);
  await mongoose.connection.close();
}

seedDB().catch(async (err) => {
  console.error(err);
  await mongoose.connection.close();
});
