const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const dbpath = path.join(__dirname, "twitterClone.db");

let db = null;

const initializationDBandServer = async () => {
  try {
    db = await open({
      filename: dbpath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server is running at http://localhost:3000/");
    });
  } catch (error) {
    console.log(`DB Error: '${error.message}'`);
    process.exit(1);
  }
};

initializationDBandServer();

//
const getFollowingPeople = async (username) => {
  const selectFollower = `SELECT following_user_id FROM follower INNER JOIN user ON user.user_id = follower.follower_user_id WHERE user.username = '${username}'`;
  const followingPeople = await db.all(selectFollower);
  const arrayOfIds = followingPeople.map(
    (eachPlay) => eachPlay.following_user_id
  );
  return arrayOfIds;
};

//
const tweetAccessVerify = async (request, response, next) => {
  const { userId } = request;
  const { tweetId } = request.params;
  const getTweetQuery = `
        SELECT * FROM tweet
        INNER JOIN follower ON tweet.user_id = follower.following_user_id
        WHERE tweet.tweet_id = ${tweetId} AND follower_user_id = ${userId}`;
  const tweet = await db.get(getTweetQuery);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

//
function authenticate(request, response, next) {
  let jwtToken;
  const getAuth = request.headers["authorization"];
  if (getAuth !== undefined) {
    jwtToken = getAuth.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "Bobby", (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        request.userId = payload.userId;
        next();
      }
    });
  }
}

// API 1
app.post("/register/", async (request, response) => {
  const { username, name, gender, password } = request.body;
  const hashPassword = await bcrypt.hash(password, 10);
  const selectUser = `SELECT * FROM user WHERE username = '${username}'`;
  const dbresponse = await db.get(selectUser);

  if (dbresponse === undefined) {
    const createNewUser = `INSERT INTO user (username, password, name, gender)
                              VALUES ('${username}','${hashPassword}', '${name}','${gender}')`;
    const dbresponse2 = await db.run(createNewUser);
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      response.status(200);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

// API 2
app.post("/login/", async (request, response) => {
  let jwtToken;
  const { username, password } = request.body;
  const selectUser = `SELECT * FROM user WHERE username = '${username}'`;
  const dbresponse = await db.get(selectUser);

  if (dbresponse === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const comparePW = await bcrypt.compare(password, dbresponse.password);
    if (comparePW === true) {
      const payload = { username, userId: dbresponse.user_id };
      jwtToken = jwt.sign(payload, "Bobby");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

// API 3
app.get("/user/tweets/feed/", authenticate, async (request, response) => {
  const { username } = request;
  const getUser = await getFollowingPeople(username);

  const selectUser = `
    SELECT username, tweet, date_time as dateTime 
    FROM user 
    INNER JOIN tweet ON 
    user.user_id = tweet.user_id
    WHERE user.user_id IN (${getUser})
    ORDER BY date_time DESC
    LIMIT 4`;
  const dbresponse = await db.all(selectUser);
  response.send(dbresponse);
});

// API 4
app.get("/user/following/", authenticate, async (request, response) => {
  const { username, userId } = request;
  const selectFollowers = `
    SELECT name FROM follower 
    INNER JOIN user ON user.user_id = follower.following_user_id 
    WHERE follower_user_id = ${userId}`;
  const dbresponse = await db.all(selectFollowers);
  response.send(dbresponse);
});

// API 5
app.get("/user/followers/", authenticate, async (request, response) => {
  const { username, userId } = request.body;
  const selectUser = `
        SELECT DISTINCT name FROM follower
        INNER JOIN user ON follower.follower_user_id = user.user_id
        WHERE following_user_id = ${userId}`;
  const dbresponse = await db.all(selectUser);
  response.send(dbresponse);
});

// API 6
app.get(
  "/tweets/:tweetId",
  authenticate,
  tweetAccessVerify,
  async (request, response) => {
    const { username, userId } = request;
    const { tweetId } = request.params;
    const getRes = `SELECT tweet (SELECT COUNT() FROM like WHERE tweet_id = '${tweetId}') AS likes,
                 (SELECT COUNT() FROM replay WHERE tweet_id = '${tweetId}') AS replies,
                 date_time AS dateTime FROM tweet WHERE tweet.tweet_id = ${tweetId}`;
    const tweet = await db.get(getRes);
    response.send(tweet);
  }
);

// API 7
app.get(
  "/tweets/:tweetId/likes/",
  authenticate,
  tweetAccessVerify,
  async (request, response) => {
    const { tweetId } = request.params;
    const getLikesQuery = `SELECT username FROM user INNER JOIN like ON user.user_id = like.user_id WHERE tweet_id = ${tweetId}`;
    const likedUsers = await db.all(getLikesQuery);
    const userArray = likedUsers.map((eachPlay) => eachPlay.username);
    response.send({ likes: userArray });
  }
);

// API 8
app.get(
  "/tweets/:tweetId/replies",
  authenticate,
  tweetAccessVerify,
  async (request, response) => {
    const { tweetId } = request.params;
    const getReplied = `SELECT name, reply FROM user INNER JOIN reply ON user.user_id = reply.user_id WHERE tweet_id = ${tweetId}`;
    const repliedUsers = await db.all(getReplied);
    response.send({ replies: repliedUsers });
  }
);

// API 9
app.get("/user/tweets/", authenticate, async (request, response) => {
  const { userId } = request;
  const getTweetsQuery = `SELECT tweet 
    COUNT (DISTINCT like_id) AS likes,
    COUNT (DISTINCT reply_id) AS replies,
    date_time AS dateTime
    FROM tweet LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
    LEFT JOIN like ON tweet.tweet_id = like.tweet_id
    WHERE tweet.user_id = ${userId}
    GROUP BY tweet.tweet_id;
     `;
  const tweets = await db.all(getTweetsQuery);
  response.send(tweets);
});

// API 10
app.post("/user/tweets/", authenticate, async (request, response) => {
  const { tweet } = request.body;
  const userId = parseInt(request.userId);
  const dateTime = new Date().toJSON().substring(0, 19).replace("T", " ");
  const createTweetQuery = `INSERT INTO tweet(tweet, user_id,date_time)
    VALUES ('${tweet}','${userId}','${dateTime}')`;
  await db.run(createTweetQuery);
  response.send("Created a Tweet");
});

// API 11
app.delete("/tweets/:tweetId/", authenticate, async (request, response) => {
  const { tweetId } = request.params;
  const { userId } = request;
  const getTheTweetQuery = `SELECT * FROM tweet WHERE user_id = ${userId} AND tweet_id = ${tweetId}`;
  const tweet = await db.get(getTheTweetQuery);
  console.log(tweet);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id = ${tweetId}`;
    await db.run(deleteTweetQuery);
    response.send("Tweet Removed");
  }
});

module.exports = app;
