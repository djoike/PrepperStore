-- Sequence and defined type
CREATE SEQUENCE IF NOT EXISTS item_identifier_type_id_seq;

-- Table Definition
CREATE TABLE IF NOT EXISTS "public"."item_identifier_type" (
    "id" int4 NOT NULL DEFAULT nextval('item_identifier_type_id_seq'::regclass),
    "name" text,
    PRIMARY KEY ("id")
);

-- Sequence and defined type
CREATE SEQUENCE IF NOT EXISTS location_type_id_seq;

-- Table Definition
CREATE TABLE IF NOT EXISTS "public"."location_type" (
    "id" int4 NOT NULL DEFAULT nextval('location_type_id_seq'::regclass),
    "name" text NOT NULL DEFAULT ''::text,
    PRIMARY KEY ("id")
);

-- Sequence and defined type
CREATE SEQUENCE IF NOT EXISTS item_id_seq;

-- Table Definition
CREATE TABLE IF NOT EXISTS "public"."item" (
    "id" int4 NOT NULL DEFAULT nextval('item_id_seq'::regclass),
    "name" text NOT NULL DEFAULT ''::text,
    "threshold" int2,
    PRIMARY KEY ("id")
);

-- Sequence and defined type
CREATE SEQUENCE IF NOT EXISTS location_id_seq;

-- Table Definition
CREATE TABLE IF NOT EXISTS "public"."location" (
    "id" int4 NOT NULL DEFAULT nextval('location_id_seq'::regclass),
    "name" text NOT NULL DEFAULT ''::text,
    "location_type" int4 NOT NULL,
    CONSTRAINT "location_location_type_id_fkey"
        FOREIGN KEY ("location_type") REFERENCES "public"."location_type"("id"),
    PRIMARY KEY ("id")
);

-- Sequence and defined type
CREATE SEQUENCE IF NOT EXISTS itemidentifier_id_seq;

-- Table Definition
CREATE TABLE IF NOT EXISTS "public"."item_identifier" (
    "id" int4 NOT NULL DEFAULT nextval('itemidentifier_id_seq'::regclass),
    "item_id" int4 NOT NULL,
    "identifier" text NOT NULL,
    "item_identifier_type" int4 NOT NULL,
    CONSTRAINT "item_identifier_item_identifier_type_fkey"
        FOREIGN KEY ("item_identifier_type") REFERENCES "public"."item_identifier_type"("id"),
    CONSTRAINT "itemidentifier_item_id_fkey"
        FOREIGN KEY ("item_id") REFERENCES "public"."item"("id"),
    PRIMARY KEY ("id")
);

-- Sequence and defined type
CREATE SEQUENCE IF NOT EXISTS item_stock_id_seq;

-- Table Definition
CREATE TABLE IF NOT EXISTS "public"."item_stock" (
    "id" int4 NOT NULL DEFAULT nextval('item_stock_id_seq'::regclass),
    "location_id" int4 NOT NULL,
    "amount" int2 NOT NULL,
    "item_id" int4 NOT NULL,
    CONSTRAINT "item_stock_item_id_fkey"
        FOREIGN KEY ("item_id") REFERENCES "public"."item"("id"),
    CONSTRAINT "item_stock_location_id_fkey"
        FOREIGN KEY ("location_id") REFERENCES "public"."location"("id"),
    PRIMARY KEY ("id")
);
