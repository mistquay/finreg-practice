from __future__ import annotations
import re

# Labels are heuristic study aids, never replacements for the original question.
RULES = [
    ('信息安全与科技风险', [('密码与认证', r'加密|密码|签名|认证|哈希|散列|RSA|AES|DES|PKI'), ('网络与应用安全', r'防火墙|入侵|攻击|漏洞|注入|XSS|病毒|木马|安全'), ('科技风险与连续性', r'风险|灾备|容灾|业务连续|外包|审计|RTO|RPO')]),
    ('数据库与数据分析', [('数据库与SQL', r'数据库|SQL|索引|范式|事务|关系代数|函数依赖|主键|外键|数据模型'), ('数据分析', r'数据挖掘|数据仓库|聚类|回归|决策树|大数据')]),
    ('网络技术及应用', [('网络协议', r'TCP|UDP|HTTP|FTP|DNS|SMTP|IP地址|IPv[46]|协议|端口'), ('网络基础', r'网络|路由|交换|VLAN|子网|以太网|链路|OSI|NAT|带宽')]),
    ('软件工程与项目管理', [('软件测试', r'测试|白盒|黑盒|覆盖率'), ('软件工程', r'软件工程|需求|生命周期|瀑布|敏捷|UML|设计模式|软件开发'), ('项目管理', r'项目|关键路径|成本管理|进度|配置管理|变更')]),
    ('信息系统架构', [('架构与云计算', r'架构|云计算|分布式|微服务|负载均衡|虚拟化|IaaS|PaaS|SaaS|信息系统')]),
    ('计算机基础', [('操作系统', r'操作系统|进程|线程|死锁|分页|页表|内存|文件系统|调度|Linux'), ('数据结构与算法', r'算法|复杂度|排序|二叉|链表|栈|队列|树|查找|散列'), ('组成与程序设计', r'CPU|计算机|寄存器|总线|存储器|程序|编译|指令|二进制|浮点|Java|C语言')]),
]

def classify(stem, number=None):
    if number and number <= 20:
        return '经济金融基础', '经济金融', '基础概念', ['经济金融']
    if number and number > 100:
        return '英语', '阅读理解', '阅读理解', ['英语阅读']
    for category, topics in RULES:
        for topic, pattern in topics:
            if re.search(pattern, stem, re.I):
                return '计算机专业', category, topic, [topic]
    return '计算机专业', '计算机基础', '综合基础', ['待细分']
