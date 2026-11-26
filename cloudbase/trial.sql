-- Run once in the CloudBase PostgreSQL environment for this test.
BEGIN;
CREATE SCHEMA osta_trial;
REVOKE ALL ON SCHEMA osta_trial FROM PUBLIC, anon, authenticated;
CREATE TABLE osta_trial.operators (subject text PRIMARY KEY);
CREATE TABLE osta_trial.people (participant text PRIMARY KEY, proof_hash bytea NOT NULL);
CREATE TABLE osta_trial.records (
  ordinal bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  id uuid PRIMARY KEY,
  participant text NOT NULL REFERENCES osta_trial.people,
  original jsonb NOT NULL,
  measurements jsonb NOT NULL,
  created timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated timestamptz NOT NULL DEFAULT clock_timestamp(),
  follow text NOT NULL DEFAULT '待跟进',
  version integer NOT NULL DEFAULT 1
);
CREATE INDEX trial_history ON osta_trial.records(participant,ordinal DESC);
REVOKE ALL ON ALL TABLES IN SCHEMA osta_trial FROM PUBLIC, anon, authenticated;
ALTER TABLE osta_trial.people ENABLE ROW LEVEL SECURITY;
ALTER TABLE osta_trial.records ENABLE ROW LEVEL SECURITY;
ALTER TABLE osta_trial.operators ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION osta_trial.measure(d jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $fn$
DECLARE
  a numeric; h numeric; w numeric; kg numeric; b numeric; score integer;
  sex text := d->>'sex'; unit text := d->>'unit'; meno text;
  reason text := ''; risk text; category text;
BEGIN
  IF NOT (coalesce(trim(d->>'age'),'') ~ '^[0-9]+(\.[0-9]{1,3})?$'
      AND coalesce(trim(d->>'height'),'') ~ '^[0-9]+(\.[0-9]{1,3})?$'
      AND coalesce(trim(d->>'weight'),'') ~ '^[0-9]+(\.[0-9]{1,3})?$') THEN
    RAISE EXCEPTION '请核对年龄、身高和体重';
  END IF;
  a := (d->>'age')::numeric; h := (d->>'height')::numeric; w := (d->>'weight')::numeric;
  IF a NOT BETWEEN 0 AND 130 OR a<>trunc(a) OR h NOT BETWEEN 20 AND 300
    OR coalesce(sex,'') NOT IN ('男','女') OR coalesce(unit,'') NOT IN ('kg','jin')
    OR w NOT BETWEEN 0.1 AND (CASE WHEN unit='jin' THEN 1500 ELSE 750 END) THEN
    RAISE EXCEPTION '请核对填写内容及计量单位';
  END IF;
  IF sex='女' THEN
    meno := d->>'menopause';
    IF coalesce(meno,'') NOT IN ('已绝经','未绝经','不确定') THEN RAISE EXCEPTION '请选择绝经状态'; END IF;
  END IF;
  kg := CASE WHEN unit='jin' THEN w/2 ELSE w END;
  IF a<18 THEN reason := '未满18周岁，本工具不评估儿童和青少年骨质疏松风险。';
  ELSIF sex='男' THEN reason := '本项目的 OSTA 筛查仅用于亚洲绝经后女性，男性请咨询医生选择评估方式。';
  ELSIF meno='未绝经' THEN reason := '本工具适用于绝经后女性，你填写的状态为未绝经。';
  ELSIF meno='不确定' THEN reason := '绝经状态尚未确定，本次不进行 OSTA 分层。';
  END IF;
  IF reason='' THEN
    score := trunc((kg-a)/5);
    risk := CASE WHEN score < -4 THEN '高风险' WHEN score <= -1 THEN '中风险' ELSE '低风险' END;
  ELSE
    risk := CASE WHEN a>=18 AND meno='不确定' THEN '暂未评估' ELSE '不适用' END;
  END IF;
  b := kg*10000/(h*h);
  category := CASE WHEN a<18 THEN '未成年人不分级'
    WHEN kg*10000<18.5*h*h THEN '体重过低' WHEN kg*10000<24*h*h THEN '体重正常'
    WHEN kg*10000<28*h*h THEN '超重' ELSE '肥胖' END;
  RETURN jsonb_build_object('age',a,'height',h,'weight',w,'sex',sex,'unit',unit,'kg',kg,'menopause',meno,
    'osta',score,'risk',risk,'reason',reason,'bmi',b,'category',category);
END $fn$;

CREATE FUNCTION osta_trial.require_admin() RETURNS void LANGUAGE plpgsql STABLE
SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM osta_trial.operators WHERE subject=auth.uid()) THEN
    RAISE EXCEPTION '请使用已获授权的管理员账号登录' USING ERRCODE='42501';
  END IF;
END $fn$;

CREATE FUNCTION public.osta_trial_write(payload jsonb, action text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE
  p text := payload->>'participant'; proof text := payload->>'proof'; req uuid;
  mode text := payload->>'mode'; m jsonb; submitted jsonb; r osta_trial.records;
BEGIN
  IF octet_length(payload::text)>12000 OR coalesce(p,'') !~ '^P[A-F0-9]{16}$'
    OR coalesce(proof,'') !~ '^[a-f0-9]{32}$' OR coalesce(action,'') NOT IN ('save','correct')
    OR coalesce(payload->>'requestId','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION '提交标识或复测凭证无效';
  END IF;
  req := (payload->>'requestId')::uuid;
  m := osta_trial.measure(payload);
  IF action='save' AND mode='new' THEN
    INSERT INTO osta_trial.people VALUES(p,sha256(convert_to(proof,'UTF8'))) ON CONFLICT DO NOTHING;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM osta_trial.people WHERE participant=p AND proof_hash=sha256(convert_to(proof,'UTF8'))) THEN
    RAISE EXCEPTION '请核对参与者编号及复测凭证' USING ERRCODE='42501';
  END IF;
  IF action='save' THEN
    IF coalesce(mode,'') NOT IN ('new','repeat') THEN RAISE EXCEPTION '请选择初次筛查或复测'; END IF;
    submitted := jsonb_build_array(mode,m->'age',m->'sex',m->'menopause',m->'height',m->'weight',m->'unit');
    INSERT INTO osta_trial.records(id,participant,original,measurements) VALUES(req,p,submitted,m) ON CONFLICT DO NOTHING;
    SELECT * INTO STRICT r FROM osta_trial.records WHERE id=req;
    IF r.participant<>p OR r.original<>submitted THEN RAISE EXCEPTION '提交标识已使用'; END IF;
  ELSE
    SELECT * INTO r FROM osta_trial.records WHERE id=req AND participant=p FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION '无法更正本次记录'; END IF;
    IF r.version=(payload->>'version')::integer THEN
      UPDATE osta_trial.records SET measurements=m,updated=clock_timestamp(),version=version+1 WHERE id=req;
    ELSIF (r.version=(payload->>'version')::integer+1 AND r.measurements=m) IS NOT TRUE THEN
      RAISE EXCEPTION '记录已变更，请刷新后重试';
    END IF;
  END IF;
  RETURN jsonb_build_object('saved',true,'participant',p);
END $fn$;

CREATE FUNCTION public.osta_trial_admin_edit(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
  PERFORM osta_trial.require_admin();
  IF payload->>'action'='correct' THEN
    UPDATE osta_trial.records SET measurements=osta_trial.measure(payload),updated=clock_timestamp(),version=version+1
    WHERE id=(payload->>'id')::uuid AND version=(payload->>'version')::integer;
  ELSIF payload->>'action'='follow' AND payload->>'follow' IN ('待跟进','已沟通','已完成骨密度检查') THEN
    UPDATE osta_trial.records SET follow=payload->>'follow',updated=clock_timestamp(),version=version+1
    WHERE id=(payload->>'id')::uuid AND version=(payload->>'version')::integer;
  ELSE RAISE EXCEPTION '更正或跟进状态无效';
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION '此记录已变更，请刷新后重试'; END IF;
  RETURN jsonb_build_object('saved',true);
END $fn$;

CREATE FUNCTION public.osta_trial_admin_list(filters jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE
  result jsonb; start_at timestamptz; end_at timestamptz;
  skip integer := coalesce((filters->>'offset')::integer,0);
  snapshot bigint := coalesce((filters->>'snapshot')::bigint,(SELECT max(ordinal) FROM osta_trial.records),0);
BEGIN
  PERFORM osta_trial.require_admin();
  IF skip<0 THEN RAISE EXCEPTION '页码无效'; END IF;
  start_at := nullif(filters->>'from','')::date::timestamp AT TIME ZONE 'Asia/Shanghai';
  end_at := (nullif(filters->>'to','')::date+1)::timestamp AT TIME ZONE 'Asia/Shanghai';
  IF start_at>=end_at THEN RAISE EXCEPTION '请核对起止日期'; END IF;
  WITH ranked AS (
    SELECT r.*, row_number() OVER(PARTITION BY participant ORDER BY ordinal DESC) AS pos
    FROM osta_trial.records r WHERE ordinal<=snapshot
      AND (coalesce(filters->>'participant','')='' OR participant=upper(trim(filters->>'participant')))
  ), filtered AS (
    SELECT * FROM ranked WHERE (start_at IS NULL OR created>=start_at) AND (end_at IS NULL OR created<end_at)
      AND (coalesce(filters->>'risk','')='' OR measurements->>'risk'=filters->>'risk')
      AND (coalesce(filters->>'follow','')='' OR follow=filters->>'follow')
  ), selected AS (
    SELECT * FROM filtered WHERE coalesce(filters->>'latest','')<>'1' OR pos=1
  ), page AS (
    SELECT * FROM selected ORDER BY ordinal DESC LIMIT 100 OFFSET skip
  ), groups AS (
    SELECT measurements->>'risk' AS risk,count(*) AS n FROM filtered WHERE pos=1 GROUP BY 1
  )
  SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(measurements||jsonb_build_object('id',id,
    'participant',participant,'created',created,'updated',updated,'follow',follow,'version',version) ORDER BY ordinal DESC)
    FROM page),'[]'::jsonb),'total',(SELECT count(*) FROM selected),'groups',coalesce((SELECT jsonb_agg(to_jsonb(groups))
    FROM groups),'[]'::jsonb),'snapshot',snapshot) INTO result;
  RETURN result;
END $fn$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA osta_trial FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.osta_trial_write(jsonb,text), public.osta_trial_admin_edit(jsonb), public.osta_trial_admin_list(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.osta_trial_write(jsonb,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.osta_trial_admin_list(jsonb), public.osta_trial_admin_edit(jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
