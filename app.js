if(process.env.NODE_ENV !== "production"){
    require('dotenv').config();
}

console.log(process.env.SECRET);


console.log(process.env.API_KEY);
const mbxGeocoding = require("@mapbox/mapbox-sdk/services/geocoding");
const mapBoxToken = process.env.MAPBOX_TOKEN;
const geocoder = mbxGeocoding({accessToken: mapBoxToken})
const {cloudinary} = require('./cloudinary');
const express = require('express');
const mongoose = require('mongoose');
const app = express();
const port = 3000;
const methodOverride = require('method-override');
const path = require('path');
const ejsMate = require('ejs-mate');
const catchAsync = require('./utils/catchAsync');
const ExpressError = require('./utils/ExpressError');
const Review = require('./models/review');
 const passport = require('passport');
 const LocalStrategy = require('passport-local');
const Campground  = require('./models/campground');
const userRoutes = require('./routes/users');
const campgroundRoutes = require('./routes/campgrounds');
const reviewRoutes = require('./routes/reviews');
const session = require('express-session');
const User = require('./models/user');
const cookieParser = require('cookie-parser');
const flash = require('express-flash');
const { campgroundSchema,reviewSchema } = require('./schemas');
const {isLoggedIn,isAuthor,validateCampground,validateReview,isReviewAuthor} = require('./middleware');
const {storage} = require('./cloudinary');
const multer = require('multer');
const upload = multer({storage});

mongoose.connect('mongodb://localhost:27017/yelp-camp',{
    useNewUrlParser: true,
    useUnifiedTopology: true,
});



const db = mongoose.connection;
db.on("error",console.error.bind(console, "connection error:"));
db.once("open", () => {
    console.log("Database Connected");
});


app.engine('ejs',ejsMate);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname,'views'));
app.use(express.urlencoded({extended:true}));
app.use(methodOverride('_method'));

app.use(express.static( path.join(__dirname, 'public')));


app.use(cookieParser());
app.use(
    session({
      resave: true,
      saveUninitialized: true,
      secret:"yash is a super star",
      cookie: { secure: false, maxAge: 14400000 },
    })
);

app.use(passport.initialize());
app.use(passport.session());
app.use(flash());
passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());




app.use(function(req,res,next){
    console.log(req.session);
    res.locals.currentUser = req.user;
    res.locals.error = req.flash('error');
    res.locals.success = req.flash('success');
    next();
});


app.get('/', (req,res) => {
    res.render('home');
});

app.get('/campgrounds', async(req,res) => {
    const campgrounds = await Campground.find({});
    res.render('campgrounds/index',{campgrounds});
});


app.post('/campgrounds',isLoggedIn, upload.array('image'), validateCampground, catchAsync(async(req,res) => {
   const geoData = await geocoder.forwardGeocode({
    query: req.body.campground.location,
    limit: 1     
   }).send()
    
    const campground = new Campground(req.body.campground);
    campground.geometry =  geoData.body.features[0].geometry;
    campground.images =  req.files.map(f => ({url: f.path, filename: f.filename}));
    campground.author = req.user._id;
    await campground.save();
    req.flash('success','Successfully Created new Campground!');
    res.redirect(`campgrounds/${campground._id}`);
})); 

app.get('/campgrounds/new',isLoggedIn, (req,res) => {
    res.render('campgrounds/new');
   
});

app.get('/campgrounds/:id', catchAsync( async(req, res) => {
    const campground = await Campground.findById(req.params.id).populate({
        path:'reviews',
    populate:{
        path:'author'
    }

}).populate('author');
    if(!campground){
        req.flash('error', 'Cannot find that Campground');
        return res.redirect('/campgrounds');
    } else {
    res.render('campgrounds/show',{ campground });
    }
}));

app.get('/campgrounds/:id/edit',isLoggedIn,isAuthor,catchAsync( async (req,res) => {
    const {id} = req.params;
    const campground = await Campground.findById(id);
    if(!campground){
        req.flash('error', 'Cannot find that Campground');
        return res.redirect('/campgrounds');
    } 
    res.render('campgrounds/edit',{campground});
    
}));

app.put('/campgrounds/:id',isLoggedIn,isAuthor, upload.array('image'), validateCampground, catchAsync( async(req,res) => {
    const {id} = req.params;
    console.log(req.body);
    const campground = await Campground.findByIdAndUpdate(id,{...req.body.campground});
    const imgs = req.files.map(f => ({url: f.path, filename: f.filename}));
    campground.images.push(...imgs);
    await campground.save();
    if(req.body.deleteImages) {
        for(let filename of req.body.deleteImages){
            await cloudinary.uploader.destroy(filename);
        }
        await campground.updateOne({$pull: {images: {filename: {$in: req.body.deleteImages}}}});
    }
    req.flash('success','Successfully Updated new Campground!');
    res.redirect(`/campgrounds/${campground._id}`);
}));


app.delete('/campgrounds/:id', isLoggedIn, isAuthor, catchAsync( async(req,res) => {
    const {id}  = req.params;
    await Campground.findByIdAndDelete(id);
    req.flash('error','Deleted a Campground');
    res.redirect('/campgrounds');
}));




app.post('/campgrounds/:id/reviews',isLoggedIn,validateReview, catchAsync(async(req,res) => {
    const campground = await Campground.findById(req.params.id);
    const review = new Review(req.body.review);
    campground.reviews.push(review);
    review.author = req.user._id;
    await review.save();
    await campground.save();
    req.flash('success', 'Created new Review!');
    res.redirect(`/campgrounds/${campground._id}`);

}));


app.delete('/campgrounds/:id/reviews/:reviewId',isLoggedIn,isReviewAuthor, catchAsync(async(req,res,next) => {
    const {id , reviewId} = req.params;
    await Campground.findByIdAndUpdate(id, {$pull: {reviews: reviewId}});
    await Review.findByIdAndDelete(reviewId);
    req.flash('error', 'Deleted a Review!');
    res.redirect(`/campgrounds/${id}`); 
}));

app.get('/register', ( req,res) => {
    res.render('users/register');
});


app.post('/register',catchAsync( async(req, res) => {
    
    try {
        const {email, username, password} = req.body;
        const user = new User({email, username});
        const registeredUser = await User.register(user, password);
        req.login(registeredUser, err => {
            if(err) return next(err);
            
        req.flash('success','Welcome to Yelp Camp!');
        res.redirect('/campgrounds');
        }); 
    }catch(e) {
        req.flash('error', e.message);
        res.redirect('/register');
    }
}));


app.get('/login', (req, res) => {

    res.render('users/login')

});


app.post('/login', passport.authenticate('local',{failureFlash: true, failureRedirect: '/login'}), (req, res) => {
    req.flash('success', 'Welcome back!');
    const redirectUrl = req.session.returnTo || '/campgrounds';
    delete req.session.returnTo;
    res.redirect(redirectUrl);
});

app.get('/logout', (req, res) => {
    req.logout(function(err) {
        if (err) { return next(err); }
        req.flash('success', 'Goodbye!');
        res.redirect('/campgrounds');
      });
});



app.all('*',(req,res,next) => {
    next(new ExpressError('Page Not Found', 404));
})

app.use((err,req,res,next) => {
    const {statusCode = 500, message = 'Something went wrong!'} = err;
    if(!err.message) err.message = 'Oh No, Something Went Wrong!';
    res.status(statusCode).render('error',{err});
    res.send();
})

app.listen(port,() => {
    console.log("Working");
});
