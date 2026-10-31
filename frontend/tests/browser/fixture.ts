import type { Workspace, Slide } from "../../src/domain/types";
const tableCustomers = {
  name: "Customers",
  columns: ["customer_id", "name"],
  rows: [
    [1, "Linh"],
    [2, "Minh"],
    [3, "An"],
  ],
};
const tableOrders = {
  name: "Orders",
  columns: ["order_id", "customer_id", "total_usd"],
  rows: [
    [101, 1, "5.50"],
    [102, 2, "3.00"],
    [103, 1, "8.00"],
  ],
};
export function fixture(): Workspace {
  const content: [string, Slide["layout"], string[]][] = [
    [
      "Introduction to Database Systems",
      "title",
      ["A café, three customers, and the data behind every order."],
    ],
    [
      "Questions for our first database lesson",
      "bullets",
      [
        "Who placed each order?",
        "Which orders total at least $5?",
        "How do we keep related changes together?",
      ],
    ],
    [
      "Database and database software",
      "process",
      [
        "Application: Sends a query",
        "DBMS: Processes the request",
        "Database: Stores the organized records.",
      ],
    ],
    ["Customer records: rows and columns", "table", []],
    ["Orders refer to a customer", "table", []],
    [
      "Keys connect the tables",
      "comparison",
      [
        "Customers · one: customer_id is the primary key",
        "Orders · many: customer_id is a foreign key.",
      ],
    ],
    [
      "Four everyday data operations",
      "process",
      [
        "Create: INSERT a new order",
        "Read: SELECT matching orders",
        "Update: UPDATE an order total",
        "Delete: DELETE a record.",
      ],
    ],
    [
      "SQL: find orders of $5 or more",
      "code",
      [
        "SELECT order_id, total_usd\nFROM orders\nWHERE total_usd >= 5\nORDER BY order_id;",
        "101 → $5.50",
        "103 → $8.00",
      ],
    ],
    [
      "JOIN connects related rows",
      "code",
      [
        "SELECT c.name, o.order_id\nFROM customers c\nJOIN orders o ON c.customer_id = o.customer_id;",
      ],
    ],
    [
      "A transaction keeps changes together",
      "process",
      [
        "Begin: Start the transaction",
        "Change: Save order + reduce stock",
        "Finish: COMMIT all, or ROLLBACK.",
      ],
    ],
    [
      "Tables, keys, queries, transactions",
      "bullets",
      [
        "Tables organize records",
        "Keys connect records",
        "Queries retrieve data",
        "Transactions group changes.",
      ],
    ],
    [
      "Read the café’s data",
      "bullets",
      [
        "Which customer placed orders 101 and 103?",
        "Why can an order not refer to customer 99?",
        "What should happen if half a checkout fails?",
      ],
    ],
  ];
  const slides: Slide[] = content.map(([title, layout, body], i) => ({
    id: `slide-${i}`,
    title,
    layout,
    body,
    notes: "Private speaker notes",
    theme: "paper",
    ...(i === 3
      ? { tableData: tableCustomers }
      : i === 4
        ? { tableData: tableOrders }
        : {}),
  }));
  return {
    version: 3,
    projects: [
      {
        id: "fixture",
        title: "Introduction to Database Systems",
        description: "A first-year lecture using a fictional café dataset.",
        systemPrompt:
          "Teach database fundamentals to beginners using the provided fictional café example. Keep one idea per slide. Preserve exact sample rows and SQL results.",
        materials: [],
        slides,
        transcript: [],
        createdAt: 1,
        updatedAt: 1,
        status: "ready",
        theme: "paper",
        rehearsals: [],
      },
    ],
  };
}
