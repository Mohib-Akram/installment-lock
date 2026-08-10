const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Test server chal raha hai!'));
app.listen(3000, () => console.log('Test server ready on port 3000'));