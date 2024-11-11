const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const pool = require("./connectDB");

const omise = require("omise")({
  secretKey: "skey_test_61mnubab14g8qct16cm",
  omiseVersion: "2019-05-29",
});

const app = express();

const secret = "mysecret";

let omiseResponse = {};

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/images/");
  },
  filename: function (req, file, cb) {
    const fileName = Date.now() + "-" + file.originalname;
    cb(null, fileName);
  },
});

const upload = multer({ storage });

const createCharge = (source, amount) => {
  return new Promise((resolve, reject) => {
    omise.charges.create(
      {
        amount: amount * 100,
        currency: "THB",
        return_uri: `http://localhost:5173/profile`,
        source,
      },
      (err, resp) => {
        if (err) {
          return reject(err);
        }
        resolve(resp);
      }
    );
  });
};

app.use("/images", express.static(path.join(__dirname, "uploads/images")));
app.use(bodyParser.json());
app.use(
  cors({
    origin: "*",
  })
);

app.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    const checkQuery = {
      text: `SELECT * FROM "user" WHERE email = $1`,
      values: [email],
    };

    const result = await pool.query(checkQuery);

    const errors = [];

    if (result.rows.length > 0) {
      const existingUser = result.rows[0];
      if (existingUser.email === email) {
        errors.push("Email already in use");
      }
    }

    if (errors.length > 0) {
      return res.status(200).json({ message: "Registration failed", errors });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    let insertQuery = {
      text: `INSERT INTO "user" (email, password) VALUES ($1, $2)`,
      values: [email, passwordHash],
    };
    await pool.query(insertQuery);

    insertQuery = {
      text: `INSERT INTO user_info (role, email) VALUES ($1, $2)`,
      values: ["user", email],
    };
    await pool.query(insertQuery);

    res.status(200).json({ message: "Register success" });
  } catch (error) {
    await pool.query(
      `SELECT setval('user_user_id_seq', (SELECT COALESCE(MAX(user_id), 1) FROM "user"))`
    );
    res.status(500).json({ message: "Register error" });
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const query = {
    text: `SELECT * FROM "user" WHERE email = $1`,
    values: [email],
  };
  try {
    const result = await pool.query(query);
    if (result.rows.length === 0) {
      res.json({ message: "Email not found" }).status(404);
      return;
    }
    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      res.json({ message: "Password incorrect" }).status(400);
      return;
    }

    const token = jwt.sign({ userId: user.user_id }, secret);

    res.json({ message: "Login success", token }).status(200);
  } catch (error) {
    res.json({ message: "Login error" }).status(500);
  }
});

app.post("/user_info", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    let authToken;
    if (authHeader) {
      authToken = authHeader.split(" ")[1];
    }
    const user = jwt.verify(authToken, secret);
    const query = {
      text: `SELECT * FROM user_info WHERE user_id = (SELECT user_id FROM "user" WHERE user_id = $1)`,
      values: [user.userId],
    };
    const result = await pool.query(query);
    res.json(result.rows[0]).status(200);
  } catch (error) {
    res.json({ message: "Authentication fail" }).status(403);
  }
});

app.post("/edit_profile", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    let authToken;
    if (authHeader) {
      authToken = authHeader.split(" ")[1];
    }
    const user = jwt.verify(authToken, secret);
    const { firstName, lastName, address, phoneNumber, secondaryPhone } =
      req.body;
    const query = {
      text: `UPDATE user_info SET name = $1, lastname = $2, address = $3, phone = $4, phone2 = $5 WHERE user_id = $6`,
      values: [
        firstName,
        lastName,
        address,
        phoneNumber,
        secondaryPhone,
        user.userId,
      ],
    };
    await pool.query(query);
    res.json({ message: "Profile updated" }).status(200);
  } catch (error) {
    res.json({ message: "Edit profile fail" }).status(403);
  }
});

app.post("/insert_item", upload.single("file"), async (req, res) => {
  try {
    const { name, category, price, status } = req.body;

    const fileName = req.file.filename;

    const query = {
      text: `INSERT INTO products (name, category, price, "imageUrl", status, "updatedAt") VALUES ($1, $2, $3, $4, $5, NOW())`,
      values: [name, category, price, `images/${fileName}`, status],
    };

    await pool.query(query);

    res.json({ message: "Insert item success" }).status(200);
  } catch (error) {
    fs.unlink(req.file.path, (err) => {
      if (err) {
        console.error("Failed to delete image:", err);
      } else {
        console.log("Image file deleted due to DB insert error.");
      }
    });
    res.json({ message: "Insert item fail" }).status(403);
  }
});

app.post("/get_item", async (req, res) => {
  try {
    const { product_id } = req.body;
    const query = {
      text: `SELECT * FROM products WHERE product_id = $1`,
      values: [product_id],
    };
    const result = await pool.query(query);
    res.json(result.rows[0]).status(200);
  } catch (error) {
    res.json({ message: "Get item fail" }).status(403);
  }
});

app.put("/update_item", upload.single("file"), async (req, res) => {
  try {
    const { product_id, name, category, price, status } = req.body;

    let query;

    if (req.file) {
      const fileName = req.file.filename;
      query = {
        text: `UPDATE products SET name = $1, category = $2, price = $3, "imageUrl" = $4, status = $5, "updatedAt" = NOW() WHERE product_id = $6`,
        values: [
          name,
          category,
          price,
          `images/${fileName}`,
          status,
          product_id,
        ],
      };
    } else {
      query = {
        text: `UPDATE products SET name = $1, category = $2, price = $3, status = $4, "updatedAt" = NOW() WHERE product_id = $5`,
        values: [name, category, price, status, product_id],
      };
    }

    await pool.query(query);

    res.json({ message: "Update item success" }).status(200);
  } catch (error) {
    res.json({ message: "Update item fail" }).status(403);
  }
});

app.delete("/delete_item", async (req, res) => {
  try {
    const { product_id } = req.body;
    const query = {
      text: `DELETE FROM products WHERE product_id = $1`,
      values: [product_id],
    };
    await pool.query(query);
    res.json({ message: "Delete item success" }).status(200);
  } catch (error) {
    res.json({ message: "Delete item fail" }).status(403);
  }
});

app.get("/admin_products", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM products`);
    const products = result.rows;
    products.forEach((product) => {
      const date = new Date(product.updatedAt);
      const formattedDate = date.toLocaleString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
      product.updatedAt = formattedDate;

      product.imageUrl = `http://localhost:3000/${product.imageUrl}`;
    });
    res.json(products).status(200);
  } catch (error) {
    res.json({ message: "Get admin product fail" }).status(500);
  }
});

app.get("/products", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM products WHERE status = 'open'`);
    const products = result.rows;
    products.forEach((product) => {
      const date = new Date(product.updatedAt);
      const formattedDate = date.toLocaleString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
      product.updatedAt = formattedDate;

      product.imageUrl = `http://localhost:3000/${product.imageUrl}`;
    });
    res.json(products).status(200);
  } catch (error) {
    res.json({ message: "Get products error" }).status(500);
  }
});

app.post("/add_to_cart", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    let authToken;
    if (authHeader) {
      authToken = authHeader.split(" ")[1];
    }
    const user = jwt.verify(authToken, secret);
    const { product_id, quantity, detail } = req.body;
    const query = {
      text: `INSERT INTO cart (user_id, product_id, quantity, detail) VALUES ($1, $2, $3, $4)`,
      values: [user.userId, product_id, quantity, detail],
    };
    await pool.query(query);
    res.json({ message: "Insert cart success" }).status(200);
  } catch (error) {
    res.json({ message: "Authentication fail" }).status(403);
  }
});

app.post("/get_cart", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    let authToken;
    if (authHeader) {
      authToken = authHeader.split(" ")[1];
    }
    const user = jwt.verify(authToken, secret);
    const query = {
      text: `SELECT 
              cart.*, 
              products.*
            FROM 
              cart
            JOIN 
              products ON cart.product_id = products.product_id
            WHERE 
              cart.user_id = $1;
            `,
      values: [user.userId],
    };
    const result = await pool.query(query);
    res.json(result.rows).status(200);
  } catch (error) {
    res.json({ message: "Authentication fail" }).status(403);
  }
});

app.put("/update_cart", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    let authToken;
    if (authHeader) {
      authToken = authHeader.split(" ")[1];
    }
    const user = jwt.verify(authToken, secret);
    const { product_id, quantity } = req.body;
    const query = {
      text: `UPDATE cart SET quantity = $1 WHERE user_id = $2 AND product_id = $3`,
      values: [quantity, user.userId, product_id],
    };
    await pool.query(query);
    res.json({ message: "Update cart success" }).status(200);
  } catch (error) {
    res.json({ message: "Update cart fail" }).status(403);
  }
});

app.delete("/delete_cart", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    let authToken;
    if (authHeader) {
      authToken = authHeader.split(" ")[1];
    }
    const user = jwt.verify(authToken, secret);
    const { product_id } = req.body;
    const query = {
      text: `DELETE FROM cart WHERE user_id = $1 AND product_id = $2`,
      values: [user.userId, product_id],
    };
    await pool.query(query);
    res.json({ message: "Delete cart success" }).status(200);
  } catch (error) {
    res.json({ message: "Delete cart fail" }).status(403);
  }
});

app.post("/insert_order", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    let authToken;
    if (authHeader) {
      authToken = authHeader.split(" ")[1];
    }
    const user = jwt.verify(authToken, secret);
    const { total, source } = req.body;

    omiseResponse = await createCharge(source, total);

    const { rows } = await pool.query(
      `SELECT address FROM user_info WHERE user_id = $1`,
      [user.userId]
    );

    const address = rows[0].address;
    let query = {
      text: `INSERT INTO orders (user_id, status, total_amount, delivery_to, create_at, charge_id, review, rating) VALUES ($1, $2, $3, $4, NOW(), $5, false, 1)`,
      values: [
        user.userId,
        "รอชำระเงิน",
        total,
        address,
        omiseResponse.id,
      ],
    };
    await pool.query(query);
    query = {
      text: `INSERT INTO order_item (order_id, product_id, quantity, detail) SELECT (SELECT MAX(order_id) FROM orders WHERE user_id = $1), product_id, quantity, detail FROM cart WHERE user_id = $1`,
      values: [user.userId],
    };
    await pool.query(query);
    query = {
      text: `DELETE FROM cart WHERE user_id = $1`,
      values: [user.userId],
    };
    await pool.query(query);
    res
      .json({
        message: "Insert order success",
        authorize_uri: omiseResponse.authorize_uri,
      })
      .status(200);
  } catch (error) {
    console.log(error);
    res.json({ message: "Insert order fail" }).status(403);
  }
});

app.post("/webhook", async (req, res) => {
  if (req.body.key === "charge.complete") {
    const webhookData = req.body.data;
    const chargeId = webhookData.id;
    const statusOrder = webhookData.status;

    try {
      const { rows } = await pool.query(
        "SELECT charge_id FROM orders WHERE charge_id = $1",
        [chargeId]
      );
      if (rows.length === 0) {
        return res.status(200).json({ message: "Order not found" });
      }
      if (statusOrder === "successful") {
        const query = {
          text: `UPDATE orders SET status = 'กำลังเตรียมอาหาร' WHERE charge_id = $1`,
          values: [chargeId],
        };
        await pool.query(query);
      } else {
        const query = {
          text: `UPDATE orders SET status = 'ชำระเงินไม่สำเร็จ' WHERE charge_id = $1`,
          values: [chargeId],
        };
        await pool.query(query);
      }
    } catch (error) {
      console.log(error);
    }
  }
});

app.post("/get_order", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    let authToken;
    if (authHeader) {
      authToken = authHeader.split(" ")[1];
    }
    const user = jwt.verify(authToken, secret);
    const query = {
      text: `SELECT 
                orders.order_id, 
                orders.status, 
                CAST(orders.total_amount AS NUMERIC) AS total_amount, 
                orders.delivery_to, 
                TO_CHAR(orders.create_at, 'DD/MM/YYYY HH:MI AM') AS create_at,
                orders.review,
                orders."reviewText",
                orders.rating,
                CONCAT(user_info.name, ' ', user_info.lastname) AS "customerName",
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'product_name', products.name, 
                        'price', products.price, 
                        'detail', order_item.detail, 
                        'quantity', order_item.quantity
                    )
                ) AS "menuItems"
            FROM 
                orders
            JOIN order_item ON orders.order_id = order_item.order_id
            JOIN products ON order_item.product_id = products.product_id
            JOIN user_info ON orders.user_id = user_info.user_id
            WHERE 
                orders.user_id = $1
            GROUP BY 
                orders.order_id, 
                orders.status, 
                orders.total_amount, 
                orders.delivery_to, 
                orders.create_at, 
                orders.review, 
                orders.rating,
                orders."reviewText",
                user_info.name, 
                user_info.lastname;
            `,
      values: [user.userId],
    };
    const result = await pool.query(query);
    res.json(result.rows).status(200);
  } catch (error) {
    res.json({ message: "Authentication fail" }).status(403);
  }
});

app.post("/get_order_id", async (req, res) => {
  try {
    const { order_id } = req.body;
    const query = {
      text: `SELECT 
                orders.order_id, 
                orders.status, 
                CAST(orders.total_amount AS NUMERIC) AS total_amount, 
                orders.delivery_to, 
                TO_CHAR(orders.create_at, 'DD/MM/YYYY HH:MI AM') AS create_at,
                orders.review,
                orders."reviewText",
                orders.rating,
                CONCAT(user_info.name, ' ', user_info.lastname) AS "customerName",
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'product_name', products.name, 
                        'price', products.price, 
                        'detail', order_item.detail, 
                        'quantity', order_item.quantity
                    )
                ) AS "menuItems"
            FROM 
                orders
            JOIN order_item ON orders.order_id = order_item.order_id
            JOIN products ON order_item.product_id = products.product_id
            JOIN user_info ON orders.user_id = user_info.user_id
            WHERE 
                orders.order_id = $1
            GROUP BY 
                orders.order_id, 
                orders.status, 
                orders.total_amount, 
                orders.delivery_to, 
                orders.create_at, 
                orders.review, 
                orders.rating,
                orders."reviewText",
                user_info.name, 
                user_info.lastname;
            `,
      values: [order_id],
    };
    const result = await pool.query(query);
    res.json(result.rows).status(200);
  } catch (error) {
    res.json({ message: "Authentication fail" }).status(403);
  }
});

app.post("/get_all_order", async (req, res) => {
  try {
    const query = {
      text: `SELECT 
                orders.order_id, 
                orders.status, 
                CAST(orders.total_amount AS NUMERIC) AS total_amount, 
                orders.delivery_to, 
                TO_CHAR(orders.create_at, 'DD/MM/YYYY HH:MI AM') AS create_at,
                orders.review,
                orders."reviewText",
                orders.rating,
                CONCAT(user_info.name, ' ', user_info.lastname) AS "customerName",
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'product_name', products.name, 
                        'price', products.price, 
                        'detail', order_item.detail, 
                        'quantity', order_item.quantity
                    )
                ) AS "menuItems"
            FROM 
                orders
            JOIN order_item ON orders.order_id = order_item.order_id
            JOIN products ON order_item.product_id = products.product_id
            JOIN user_info ON orders.user_id = user_info.user_id
            GROUP BY 
                orders.order_id, 
                orders.status, 
                orders.total_amount, 
                orders.delivery_to, 
                orders.create_at, 
                orders.review, 
                orders.rating,
                orders."reviewText",
                user_info.name, 
                user_info.lastname;
            `,
    };
    const result = await pool.query(query);
    res.json(result.rows).status(200);
  } catch (error) {
    res.json({ message: "Authentication fail" }).status(403);
  }
});

app.post("/update_order_status", async (req, res) => {
  try {
    const { order_id, status } = req.body;
    const query = {
      text: `UPDATE orders SET status = $1 WHERE order_id = $2`,
      values: [status, order_id],
    };
    await pool.query(query);
    res.json({ message: "Update order status success" }).status(200);
  } catch (error) {
    res.json({ message: "Update order status fail" }).status(403);
  }
});

app.put('/update_review', async (req, res) => {
  try {
    const { order_id, reviewText, rating } = req.body;
    const query = {
      text: `UPDATE orders SET review = true, "reviewText" = $1, rating = $2 WHERE order_id = $3`,
      values: [reviewText, rating, order_id],
    };
    await pool.query(query);
    res.json({ message: "Update review success" }).status(200);
  } catch (error) {
    res.json({ message: "Update review fail" }).status(403);
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
