const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// middleware
app.use(cors());
app.use(express.json());

const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  console.log(authorization);
  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "unauthorized access" });
  }
  // bearer token
  const token = authorization.split(" ")[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res
        .status(401)
        .send({ error: true, message: "unauthorized access" });
    }
    req.decoded = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.5acr8wm.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // client.connect();

    const sliderCollection = client.db("sportDb").collection("slider");
    const usersCollection = client.db("sportDb").collection("users");
    const classesCollection = client.db("sportDb").collection("classes");
    const selectedClassesCollection = client
      .db("sportDb")
      .collection("selectedClasses");
    const paymentCollection = client.db("sportDb").collection("payments");

    // Jwt Post

    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });

      res.send({ token });
    });
    // verify Admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (
        user?.role !== "admin" &&
        user?.role !== "instructor" &&
        user?.role !== "student"
      ) {
        return res
          .status(403)
          .send({ error: false, message: "forbidden message" });
      }
      next();
    };

    app.get("/slider", async (req, res) => {
      const result = await sliderCollection.find().toArray();
      res.send(result);
    });

    // users collection

    app.post("/users", async (req, res) => {
      const user = req.body;

      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);

      if (existingUser) {
        return res.send({ message: "User already exists" });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      let role;
      if (user.role === "admin") {
        role = "admin";
      } else if (user.role === "student") {
        role = "student";
      } else if (user.role === "instructor") {
        role = "instructor";
      } else {
        role = "unknown";
      }

      res.send({ role }); // Send the role as a response
    });

    app.patch("/users/admin/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;

      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    app.patch(
      "/users/instructor/:id",

      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            role: "instructor",
          },
        };

        const result = await usersCollection.updateOne(filter, updateDoc);
        res.send(result);
      }
    );
    // allInstructor items
    app.get("/allInstructor", async (req, res) => {
      try {
        const pipeline = [
          {
            $match: {
              seatBookings: { $gt: 0 },
            },
          },
          {
            $group: {
              _id: "$instructorEmail",
              data: { $first: "$$ROOT" },
              totalClasses: { $sum: 1 },
            },
          },
          {
            $replaceRoot: { newRoot: "$data" },
          },
          {
            $sort: {
              seatBookings: -1,
            },
          },
          {
            $limit: 6,
          },
        ];

        const result = await classesCollection.aggregate(pipeline).toArray();
        res.send(result);
      } catch (error) {
        console.log(error);
        res.status(500).send({ error: true, message: "Internal Server Error" });
      }
    });

    app.get("/instructors", async (req, res) => {
      try {
        const pipeline = [
          {
            $group: {
              _id: "$instructorEmail",
              instructorName: { $first: "$instructorName" },
              email: { $first: "$instructorEmail" },
              photoUrl: { $first: "$photoUrl" },
              totalClasses: { $sum: 1 },
            },
          },
          {
            $sort: {
              instructorName: 1,
            },
          },
        ];

        const result = await classesCollection.aggregate(pipeline).toArray();
        res.send(result);
      } catch (error) {
        console.log(error);
        res.status(500).send({ error: true, message: "Internal Server Error" });
      }
    });

    // Classes

    app.post("/classes", verifyJWT, verifyAdmin, async (req, res) => {
      const classData = req.body;

      const result = await classesCollection.insertOne(classData);
      res.send(result);
    });

    app.get("/classes", async (req, res) => {
      const result = await classesCollection.find().toArray();
      res.send(result);
    });

    app.get("/top-classes", async (req, res) => {
      try {
        const result = await classesCollection
          .find({ status: "approved" })
          .sort({ seatBookings: -1 })
          .limit(6)
          .toArray();
        res.send(result);
      } catch (error) {
        console.log(error);
        res.status(500).send({ error: true, message: "Internal Server Error" });
      }
    });

    app.patch(
      "/classes/approve/:id",
      verifyJWT,
      verifyAdmin,

      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            status: "approved",
          },
        };

        const result = await classesCollection.updateOne(filter, updateDoc);
        res.send(result);
      }
    );

    app.patch("/classes/deny/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          status: "denied",
        },
      };

      const result = await classesCollection.updateOne(filter, updateDoc);
      res.send(result);
    });
    // class feedback
    app.patch(
      "/classes/feedback/:id",
      verifyJWT,
      verifyAdmin,

      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            feedback: req.body.feedback,
          },
        };

        const result = await classesCollection.updateOne(filter, updateDoc);
        res.send(result);
      }
    );

    app.patch("/classes/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: req.body,
      };

      const result = await classesCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // Selected classes collection

    app.post("/selected-classes", verifyJWT, verifyAdmin, async (req, res) => {
      const classData = req.body;
      const result = await selectedClassesCollection.insertOne(classData);
      res.send(result);
    });

    app.get("/selected-classes", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await selectedClassesCollection.find().toArray();
      res.send(result);
    });

    app.get(
      "/selected-classes/:email",

      async (req, res) => {
        const email = req.params.email;
        const result = await selectedClassesCollection
          .find({ studentEmail: email })
          .toArray();
        res.send(result);
      }
    );
    app.get(
      "/selected-classes/id/:id",

      async (req, res) => {
        const result = await selectedClassesCollection.findOne({
          _id: new ObjectId(req.params.id),
        });
        res.send(result);
      }
    );

    app.delete(
      "/selected-classes/:id",
      verifyJWT,
      verifyAdmin,

      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const result = await selectedClassesCollection.deleteOne(filter);
        res.send(result);
      }
    );

    // Payment
    app.post(
      "/create-payment-intent",
      verifyJWT,
      verifyAdmin,

      async (req, res) => {
        const { price } = req.body;
        const amount = price * 100;
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: "usd",
          payment_method_types: ["card"],
        });
        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      }
    );

    app.post("/payments", verifyJWT, verifyAdmin, async (req, res) => {
      const payment = req.body;
      const insertResult = await paymentCollection.insertOne(payment);

      const classId = payment.classId;
      const enrolledFilter = { _id: new ObjectId(classId) };
      const enrolledUpdate = {
        $set: {
          enrolled: true,
        },
      };
      const enrolledUpdateResult = await selectedClassesCollection.updateOne(
        enrolledFilter,
        enrolledUpdate
      );

      // Get the modified count from the update result
      const modifiedCount = enrolledUpdateResult.modifiedCount;

      const selectedId = payment.selectedId;

      const availableSeatsFilter = { _id: new ObjectId(selectedId) };
      const availableSeatsUpdate = {
        $inc: { availableSeats: -1, seatBookings: +1 },
      };
      const availableSeatsResult = await classesCollection.updateOne(
        availableSeatsFilter,
        availableSeatsUpdate
      );

      res.send({ insertResult, modifiedCount, availableSeatsResult });
    });

    app.get("/payments/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const result = await paymentCollection
        .find({ email: email })
        .sort({ date: -1 })
        .toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
