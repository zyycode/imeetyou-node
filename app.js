const express = require('express')
const bodyParser = require('body-parser')
const cookieParser = require('cookie-parser')
const multer = require('multer')
const path = require('path')
const sqlite = require('sqlite')
const svgCaptcha = require('svg-captcha')

const app = express()
const port = 3000
let sessions = {}
// 获取数据库资源
const dbPromise = sqlite.open(path.join(__dirname, './bbs.db'), { Promise })

app.locals.pretty = true

app.use('/static', express.static('./static'))

app.use((req, res, next) => {
  console.log(req.method, req.url)
  next()
})

// 设置 cookie 私钥
app.use(cookieParser('abcdef'))
app.use(bodyParser.urlencoded())
app.use(bodyParser.json())

// 给访问的客户端设置sessionId
app.use(function sessionMiddleware(req, res, next) {
  if (!req.cookies.sessionId) {
    res.cookie('sessionId', Math.random().toString(16).substr(2))
  }
  next()
})

// 判断用户是否登录
app.use(async (req, res, next) => {
  req.user = await db.get('SELECT * FROM users WHERE id=?', req.signedCookies.userid)
  next()
})

// 首页
app.get('/', async (req, res, next) => {
  let posts = await db.all('SELECT * FROM posts')
  res.render('index.pug', { posts, user: req.user })
})

app.get('/api/posts', async (req, res, next) => {
  let posts = await db.all('SELECT posts.*, users.name FROM posts JOIN users ON posts.userId=users.id')
  res.json(posts)
})

app.get('/api/post/:postid', async (req, res, next) => {
  let post = await db.get('SELECT posts.*, users.name FROM posts JOIN users ON posts.userId=users.id WHERE posts.id=?', req.params.postid)
  res.json(post)
})

app.get('/api/user/:userid', async (req, res, next) => {
  let user = await db.get('SELECT users.id, users.name FROM users WHERE id=?', req.params.userid)
  let userPosts = await db.all('SELECT * FROM posts WHERE userId=?', req.params.userid)
  let userComents = await db.all('SELECT coments.*, title AS postTitle FROM coments JOIN posts ON coments.postId=posts.id WHERE coments.userId=?', req.params.userid)  
  res.json({
    user,
    userPosts,
    userComents
  })
})

app.get('/api/userinfo', async (req, res, next) => {
  if (req.user) {
    res.json(req.user)
  } else {
    res.status(401).json({
      code: -1,
      msg: 'unauthorized'
    })
  }
})

app.get('/api/coments/:postid', async (req, res, next) => {
  let coments = await db.all('SELECT coments.*, name FROM coments JOIN users ON coments.userId=users.id WHERE postId=?', req.params.postid)
  res.json(coments)
})

// 注册
app.route('/register')
  .get((req, res) => {
    res.render('register.pug')
  })
  .post(async (req, res) => {
    console.log(req.body)
    let users = await db.get('SELECT * FROM users WHERE name=?', req.body.username)
    if (users) {
      res.end('user has been registered!')
    } else {
      await db.run('INSERT INTO users (name, password) VALUES (?,?)', req.body.username, req.body.password)
      res.redirect('/login')
    }
  })

// 登录
app.route('/login')
  .get((req, res) => {
    res.render('login.pug')
  })
  .post(async (req, res) => {
    if (req.body.captcha != sessions[req.cookies.sessionId].captcha) {
      // res.end('captcha is not corrent!')
      res.status(403).json({
        code: -1,
        msg: 'captcha not correct!'
      })
      return
    }
    let user = await db.get('SELECT * FROM users WHERE name=? AND password=?', req.body.username, req.body.password)
    if (user) {
      res.cookie('userid', user.id, {
        signed: true
      })
      res.json(user)
    } else {
      res.status(403).json({
        code: -1,
        msg: 'username or password not correct!'
      })
    }
  })

// 验证码
app.get('/captcha', (req, res, next) => {
  let captcha = svgCaptcha.create({color: true, ignoreChars: '0o1i' })
  sessions[req.cookies.sessionId] = {
    captcha: captcha.text
  }
  res.type('svg')
  res.send(captcha.data)
  // res.end(`
  // <svg width="100" height="50" version="1.1" xmlns="http://www.w3.org/2000/svg">
  //   <text x="0" y="20">${
  //     captcha
  //   }</text>
  // </svg>
  // `)
})

// 登出(清除cookie)
app.get('/logout', (req, res, next) => {
  res.clearCookie('userid')
  res.redirect('/')
})

// 用户
app.get('/user/:userid', async (req, res, next) => {
  let userid = req.params.userid
  // let user = await db.get('SELECT * FROM users WHERE id=?', userid)
  if (req.user) {
    let userPosts = await db.all('SELECT * FROM posts WHERE userId=?', userid)
    let userComents = await db.all('SELECT coments.*, title AS postTitle FROM coments JOIN posts ON coments.postId=posts.id WHERE coments.userId=?', userid)
    res.render('user.pug', { user: req.user, userPosts, userComents })
  } else {
    res.render('user.pug', { user: req.user })
  }
})

// 帖子详情
app.get('/post/:postid', async (req, res, next) => {
  let postid = req.params.postid
  let post = await db.get('SELECT posts.*, name FROM posts JOIN users ON posts.userId=users.id WHERE posts.id=?', postid)
  if (post) {
    let coments = await db.all('SELECT coments.*, name FROM coments JOIN users ON coments.userId=users.id WHERE postId=?', postid)
    res.render('post.pug', { post, coments, user: req.user })
  } else {
    res.status(404).render('post-not-found.pug')
  }
})

// 添加评论(通过cookie判断用户id)
app.post('/add-coment', async (req, res, next) => {
  console.log(req.body)
  if (req.signedCookies.userid) {
    await db.run('INSERT INTO coments VALUES (null,?,?,?,?)'
    , req.signedCookies.userid, req.body.postid, req.body.content, Date.now())
    let coment = await db.get('SELECT * FROM coments JOIN users ON coments.userId=users.id ORDER BY timetamp DESC LIMIT 1')
    
    res.json(coment)
  } else {
    res.end('You cannot add comment, you are not logged in.')
  }
})

// 发帖
app.route('/add-post')
  .get((req, res) => {
    res.render('add-post.pug')
  })
  .post(async (req, res, next) => {
    if (req.signedCookies.userid) {
      await db.run('INSERT INTO posts (userId, title, content, timetamp) VALUES (?,?,?,?)'
      , req.signedCookies.userid, req.body.title, req.body.content, Date.now())
      let newPost = await db.get('SELECT * FROM posts ORDER BY timetamp DESC LIMIT 1')
      console.log(newPost)
      res.json(newPost)
    } else {
      res.end('sorry, You are not logged in!')
    }
  })

// 删除帖子
app.get('/del-post/:postid', async (req, res, next) => {
  let post = await db.get('SELECT * FROM posts WHERE id=?', req.params.postid)
  if (post && req.user) {
    if (post.userId == req.user.id) {
      await db.run('DELETE FROM posts WHERE id=?', post.id)
    }
  }
  res.redirect(req.headers.referer)
})

// 删除评论
app.get('/del-coment/:userid', async (req, res, next) => {
  let coment = await db.get('SELECT * FROM coments WHERE id=?', req.params.userid)
  if (coment && req.user) {
    if (coment.userId == req.user.id) {
      await db.run('DELETE FROM coments WHERE id=?', coment.id)
    }
  }
  res.redirect(req.headers.referer)
})

;(async function() {
  db = await dbPromise
  app.listen(port, () => {
    console.log(`server is listening at port ${port}.`)
  })
}())
